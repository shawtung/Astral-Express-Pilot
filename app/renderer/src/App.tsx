import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PilotApi } from '../../preload/index.ts';
import { Guide } from './Guide.tsx';

declare global {
  interface Window {
    pilot: PilotApi;
  }
}

type Mode = 'standard' | 'overclock';
type Combine = 'or' | 'and';

type Config = {
  mode: Mode;
  combine: Combine;
  smartEnvironment: boolean;
  environments: string[];
  strategies: string[];
  plane: number;
};

type CodexEnvironment = { name: string; standardOnly: boolean };
type CodexStrategy = {
  name: string;
  rarity: string;
  planes: number[];
  standardOnly: boolean;
};
type Codex = { environments: CodexEnvironment[]; strategies: CodexStrategy[] };

type Option = { name: string; hint?: string; rarity?: string };
type LogLine = { at: number; message: string };

/** A log line ready to render: the clock string is formatted once, not on every repaint. */
type Line = { id: number; time: string; message: string; tone: Tone };

type Tone = 'info' | 'good' | 'bad';

/** In-game rarity to CSS class. Anything unexpected is left uncoloured rather than guessed at. */
const RARITY_CLASS: Record<string, string> = {
  棱彩: 'r-prismatic',
  黄金: 'r-gold',
  白银: 'r-silver',
};

function rarityClass(rarity?: string): string {
  return (rarity && RARITY_CLASS[rarity]) ?? '';
}

/** A screenshot path, anchored on the label that precedes it: the path itself contains spaces
 * (`Application Support`), so nothing else in the line can tell where it starts. */
const CAPTURE_PATH = String.raw`(?<=\u622a\u56fe[:\uff1a]\s)[^\n]+\.png`;

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The stream carries plain text, so the leading tag is all there is to tell a failure apart. */
function toneOf(message: string): Tone {
  if (message.startsWith('完成:')) return 'good';
  if (message.startsWith('停止:') || message.startsWith('出错:') || message.startsWith('截图失败:')) return 'bad';
  return 'info';
}

const STORE_KEY = 'pilot.config';
const HEADLESS_KEY = 'pilot.headless';
const MAX_PICKS = 5;

/** Oldest lines are dropped past this, since the stream has no virtual scrolling. */
const MAX_LOGS = 500;

const DEFAULT_CONFIG: Config = {
  mode: 'overclock',
  combine: 'or',
  smartEnvironment: true,
  environments: [],
  strategies: [],
  plane: 1,
};

function loadConfig(): Config {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<Config>) } : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** Electron never renders the native `title` tooltip, so hints have to be drawn by hand. */
function Info({ children }: { children: ReactNode }) {
  return (
    <span
      className='tip'
      tabIndex={0}
      // These sit inside a label, where any click would otherwise flip the checkbox.
      onClick={(event) => event.preventDefault()}
    >
      <span className='tip-icon'>ⓘ</span>
      <span className="bubble">{children}</span>
    </span>
  );
}

function MultiSelect({
  title,
  options,
  chosen,
  onChange,
  disabled = false,
  extra,
}: {
  title: string;
  options: Option[];
  chosen: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  extra?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const expanded = open && !disabled;

  useEffect(() => {
    if (!expanded) return;
    search.current?.focus();
    const onDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [expanded]);

  const shown = useMemo(() => {
    const key = keyword.trim();
    return key ? options.filter((item) => item.name.includes(key)) : options;
  }, [options, keyword]);

  // Chips only carry a name, so the tint has to be looked back up from the option list.
  const tints = useMemo(
    () => new Map(options.map((item) => [item.name, rarityClass(item.rarity)])),
    [options],
  );

  const full = chosen.length >= MAX_PICKS;

  function toggle(name: string) {
    if (chosen.includes(name)) onChange(chosen.filter((item) => item !== name));
    else if (!full) onChange([...chosen, name]);
  }

  return (
    <div className={disabled ? 'field off' : 'field'} ref={box}>
      <div className="field-head">
        <span className="label">{title}</span>
        {extra}
        <span className={full ? 'quota full' : 'quota'}>
          {chosen.length}/{MAX_PICKS}
        </span>
      </div>

      <button
        type="button"
        className="control"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
      >
        {chosen.length ? (
          <span className="chips">
            {chosen.map((name) => (
              <span
                key={name}
                className={`chip ${tints.get(name) ?? ''}`}
                // Fires before the outside-click listener, so removing a chip never reopens the menu.
                onPointerDown={(event) => {
                  event.stopPropagation();
                  toggle(name);
                }}
              >
                {name} <span aria-hidden>x</span>
              </span>
            ))}
          </span>
        ) : (
          <span className="placeholder">点击选择，最多 {MAX_PICKS} 个</span>
        )}
        <span className={expanded ? 'caret up' : 'caret'} aria-hidden />
      </button>

      {expanded && (
        <div className="menu">
          <input
            ref={search}
            value={keyword}
            placeholder="搜索名称"
            onChange={(event) => setKeyword(event.target.value)}
          />
          <ul>
            {shown.map((item) => {
              const on = chosen.includes(item.name);
              return (
                <li key={item.name}>
                  <button
                    type="button"
                    className={on ? 'option on' : 'option'}
                    disabled={!on && full}
                    onClick={() => toggle(item.name)}
                  >
                    <span className="tick" aria-hidden>
                      {on ? '✓' : ''}
                    </span>
                    <span className={`name ${rarityClass(item.rarity)}`}>{item.name}</span>
                    {item.hint && <em>{item.hint}</em>}
                  </button>
                </li>
              );
            })}
            {!shown.length && <li className="empty">没有匹配项</li>}
          </ul>
          {full && <p className="quota-hint">已选满 {MAX_PICKS} 个，取消一个才能再选</p>}
        </div>
      )}
    </div>
  );
}

/**
 * One log line, with strategy names tinted by rarity and screenshot paths turned into links.
 * Memoised because the whole stream re-renders on every incoming line.
 */
const LogRow = memo(function LogRow({
  line,
  pattern,
  tints,
  onPreview,
}: {
  line: Line;
  pattern: RegExp;
  tints: Map<string, string>;
  onPreview: (path: string | null) => void;
}) {
  return (
    <p className={line.tone}>
      <time>{line.time}</time>
      <span className="text">
        {line.message.split(pattern).map((part, index) => {
          if (index % 2 === 0) return part;
          if (part.toLowerCase().endsWith('.png')) {
            return (
              <button
                key={index}
                type="button"
                className="path-link"
                onClick={() => void window.pilot.openCapture(part)}
                onMouseEnter={() => onPreview(part)}
                onMouseLeave={() => onPreview(null)}
              >
                {part}
              </button>
            );
          }
          const tint = tints.get(part);
          return tint ? (
            <span key={index} className={tint}>
              {part}
            </span>
          ) : (
            part
          );
        })}
      </span>
    </p>
  );
});

export function App() {
  const [config, setConfig] = useState<Config>(loadConfig);
  const [headless, setHeadless] = useState(() => localStorage.getItem(HEADLESS_KEY) === '1');
  const [codex, setCodex] = useState<Codex | null>(null);
  const [logs, setLogs] = useState<Line[]>([]);
  const [browserReady, setBrowserReady] = useState(false);
  const [busy, setBusy] = useState<'idle' | 'opening' | 'running'>('idle');
  const [error, setError] = useState('');
  const [guide, setGuide] = useState(false);
  const [dataDir, setDataDir] = useState('');
  /** Screenshot path currently hovered in the log stream, previewed in a fixed overlay. */
  const [preview, setPreview] = useState<string | null>(null);
  /** Resolved img src for `preview`, since the scheme differs between dev and packaged. */
  const [previewSrc, setPreviewSrc] = useState('');
  const tail = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!preview) {
      setPreviewSrc('');
      return;
    }
    let stale = false;
    void window.pilot.captureUrl(preview).then((url) => {
      if (!stale) setPreviewSrc(url);
    });
    return () => {
      stale = true;
    };
  }, [preview]);

  useEffect(() => {
    void window.pilot.loadCodex().then(setCodex);
    void window.pilot.dataDir().then(setDataDir);
    return window.pilot.onLog((line: LogLine) =>
      setLogs((prev) => [
        ...prev.slice(1 - MAX_LOGS),
        {
          id: seq.current++,
          time: new Date(line.at).toLocaleTimeString('zh-CN', { hour12: false }),
          message: line.message,
          tone: toneOf(line.message),
        },
      ]),
    );
  }, []);

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    localStorage.setItem(HEADLESS_KEY, headless ? '1' : '0');
  }, [headless]);

  useEffect(() => {
    tail.current?.scrollIntoView({ block: 'end' });
  }, [logs]);

  const overclock = config.mode === 'overclock';

  const environmentOptions = useMemo<Option[]>(() => {
    if (!codex) return [];
    return codex.environments
      .filter((item) => !(overclock && item.standardOnly))
      .map((item) => ({ name: item.name }));
  }, [codex, overclock]);

  const strategyOptions = useMemo<Option[]>(() => {
    if (!codex) return [];
    return codex.strategies
      .filter((item) => !(overclock && item.standardOnly))
      .filter((item) => item.planes.includes(config.plane))
      .map((item) => ({ name: item.name, hint: item.rarity, rarity: item.rarity }));
  }, [codex, overclock, config.plane]);

  // Every plane and both modes, since the log quotes whatever the game happened to deal.
  const logTints = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of codex?.strategies ?? []) {
      const tint = rarityClass(item.rarity);
      if (tint) map.set(item.name, tint);
    }
    return map;
  }, [codex]);

  const logPattern = useMemo(() => {
    // Longest first, so 秘密典籍+ is not cut short by 秘密典籍.
    const names = [...logTints.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
    return new RegExp(`(${[CAPTURE_PATH, ...names].join('|')})`);
  }, [logTints]);

  const hasTarget = config.smartEnvironment
    ? config.strategies.length > 0
    : config.environments.length > 0 || config.strategies.length > 0;

  async function start() {
    setError('');
    setBusy('running');
    try {
      await window.pilot.start(config);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy('idle');
    }
  }

  async function openBrowser() {
    setError('');
    setBusy('opening');
    let ready = false;
    try {
      ready = (await window.pilot.openBrowser(headless)).ok;
      setBrowserReady(ready);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy('idle');
    }

    // Headless leaves nobody watching a window, so the run starts on its own.
    if (ready && headless && hasTarget) await start();
  }

  const canStart = browserReady && busy === 'idle' && hasTarget;
  // The config is snapshotted when a run starts, so editing it mid-run would silently do nothing.
  const locked = busy === 'running';

  return (
    <div className="app">
      <header className="bar">
        <h1>Astral Express Pilot</h1>

        <div className={locked ? 'segmented off' : 'segmented'}>
          {(['standard', 'overclock'] as Mode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={config.mode === mode ? 'on' : ''}
              disabled={locked}
              onClick={() => setConfig((prev) => ({ ...prev, mode }))}
            >
              {mode === 'standard' ? '标准博弈' : '超频博弈'}
            </button>
          ))}
        </div>

        <div className={config.smartEnvironment || locked ? 'segmented off' : 'segmented'}>
          {(['or', 'and'] as Combine[]).map((combine) => (
            <button
              key={combine}
              type="button"
              className={config.combine === combine ? 'on' : ''}
              disabled={config.smartEnvironment || locked}
              onClick={() => setConfig((prev) => ({ ...prev, combine }))}
            >
              {combine === 'or' ? '满足其一' : '两者都要'}
            </button>
          ))}
        </div>

        <div className="spacer" />

        <label className="toggle">
          <input
            type="checkbox"
            checked={headless}
            disabled={browserReady || busy !== 'idle'}
            onChange={(event) => setHeadless(event.target.checked)}
          />
          <span className="toggle-text">无头模式</span>
          <Info>
            不开游戏窗口，只在后台跑，运行情况看下方日志。打开浏览器后就不能再改，要切换得先关掉浏览器。首次使用请先用有头模式登录并按「使用指南」设置好游戏。
          </Info>
        </label>

        <button
          type="button"
          onClick={openBrowser}
          disabled={busy !== 'idle' || (headless && !hasTarget)}
        >
          {browserReady ? '浏览器已就绪' : busy === 'opening' ? '打开中...' : '打开浏览器'}
        </button>
        <button type="button" className="primary" onClick={start} disabled={!canStart}>
          {busy === 'running' ? '刷取中...' : '开始刷取'}
        </button>
        <button type="button" onClick={() => void window.pilot.stop()} disabled={busy === 'idle'}>
          停止
        </button>
        <button type="button" onClick={() => setGuide(true)}>
          使用指南
        </button>
      </header>

      <section className="fields">
        <MultiSelect
          title="投资环境"
          options={environmentOptions}
          chosen={config.environments}
          onChange={(environments) => setConfig((prev) => ({ ...prev, environments }))}
          disabled={config.smartEnvironment || locked}
          extra={
            <label className="toggle">
              <input
                type="checkbox"
                checked={config.smartEnvironment}
                disabled={locked}
                onChange={(event) =>
                  setConfig((prev) => ({ ...prev, smartEnvironment: event.target.checked }))
                }
              />
              <span className="toggle-text">智能选择环境</span>
              <Info>
                按所选投资策略的稀有度自动决定环境优先级。只要一种稀有度时，先挑该稀有度的专属环境（棱彩→彩虹时代，黄金→黄金时代，白银→白银时代），其次「银·金·彩」；同时要多种稀有度时，只有「银·金·彩」能一次出全，所以它排第一。开启后投资环境选择和「满足其一 / 两者都要」都不再生效，只以投资策略为目标。
              </Info>
            </label>
          }
        />
        <MultiSelect
          title="投资策略"
          options={strategyOptions}
          chosen={config.strategies}
          onChange={(strategies) => setConfig((prev) => ({ ...prev, strategies }))}
          disabled={locked}
        />
      </section>

      <p className="hint">
        {locked
          ? '配置已在开始时锁定，改动要停下来重新开始才生效。'
          : headless
            ? '选好目标后点打开浏览器，会自己进游戏并开始刷取，全程看下方日志。'
            : '先打开浏览器，自己登录云游戏并把画面停在「货币战争」初始界面，再点开始刷取。'}
      </p>
      {error && <p className="error">{error}</p>}

      <section className="logs">
        <div className="stream">
          {logs.map((line) => (
            <LogRow
              key={line.id}
              line={line}
              pattern={logPattern}
              tints={logTints}
              onPreview={setPreview}
            />
          ))}
          <div ref={tail} />
        </div>
      </section>
      {preview && previewSrc && (
        <div className="shot-preview">
          <img src={previewSrc} alt="现场截图预览" />
        </div>
      )}
      {guide && <Guide dataDir={dataDir} onClose={() => setGuide(false)} />}
    </div>
  );
}
