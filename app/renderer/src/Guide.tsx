import { useEffect } from 'react';

/** The version whose screen layout the anchors and button coordinates were measured against. */
const GAME_VERSION = 'V4.4';

export function Guide({ dataDir, onClose }: { dataDir: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="mask" onPointerDown={onClose}>
      <div className="guide" onPointerDown={(event) => event.stopPropagation()}>
        <header>
          <h2>使用指南</h2>
          <span className="tag">适配游戏版本 {GAME_VERSION}</span>
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="body">
          <h3>这个模块做什么</h3>
          <p>
            自动重复刷「货币战争」：每局开出投资环境和投资策略后比对你设定的目标，命中就停下并关掉
            游戏标签页，没命中就放弃本局重开，如此往复。目标可以是<b>指定的投资环境</b>，也可以是
            <b>第一位面的指定投资策略</b>，两者各最多选 5 个。当前仅支持第一位面。
          </p>

          <h3>初次使用</h3>
          <p>下面每一步都必须做完，否则自动刷取会中途卡住。</p>
          <ol>
            <li>
              确认本机装有 <b>Google Chrome</b>。程序直接调用系统 Chrome，没有它打不开云游戏。
            </li>
            <li>
              <b>不要</b>勾选无头模式，点「打开浏览器」，在弹出的窗口里完成云游戏登录。
            </li>
            <li>
              进入游戏后修改设置：
              <ul>
                <li>
                  <b>语言：简体中文</b>。文字识别只认简体中文，其他语言一律无法识别。
                </li>
                <li>
                  <b>沿用自动战斗设置</b>。
                </li>
              </ul>
            </li>
            <li>
              随便进一场战斗，打开<b>自动战斗</b>。这个开关会被记住，之后每局战斗才能自动打完。
            </li>
            <li>
              选好「货币战争」的难度。
            </li>
            <li>把画面停在「货币战争」活动首页（能看到「开始「货币战争」」按钮）。</li>
          </ol>
          <p>
            以上做完后，登录状态和游戏内设置都会保存下来，之后就可以直接自动刷取，或改用无头模式。
          </p>

          <h3>日常使用</h3>
          <ul>
            <li>
              <b>有头模式</b>：点「打开浏览器」，自己把画面停在活动首页，再点「开始刷取」。
            </li>
            <li>
              <b>无头模式</b>：不开窗口。先选好目标，点「打开浏览器」后会自己进游戏、走到活动页并
              开始刷取，全程只能看日志。
            </li>
            <li>配置在点「开始刷取」的那一刻锁定，中途改动要先停止再重新开始才生效。</li>
            <li>
              日志里<span className="good">金色</span>是刷到目标，
              <span className="bad">红色</span>是卡住或出错，都会附上现场截图路径。
            </li>
            <li>
              刷到目标、卡住、出错都会弹<b>系统通知</b>，点通知能把窗口叫回来。收不到就去系统的
              通知设置里给本程序放行。
            </li>
          </ul>

          <h3>数据目录</h3>
          <p>登录状态、运行截图都存在这里。删掉它等于退出登录。</p>
          <p className="path">
            <code>{dataDir || '(未就绪)'}</code>
            <button type="button" onClick={() => void window.pilot.openDataDir()}>
              打开
            </button>
          </p>

          <h3>注意事项</h3>
          <ul>
            <li>
              <b>有头模式运行时不要碰游戏窗口</b>，鼠标点击和键盘输入会和自动操作打架。
            </li>
            <li>
              云游戏自带的<b>悬浮窗（如侧边栏按钮）开启时会盖在画面左侧</b>，正好挡住羁绊识别和
              退出按钮所在区域，开始刷取前请先把浮窗收起或拖到别处。
            </li>
            <li>
              放弃本局前要先随手选掉一张投资策略，此时会<b>避开内置的黑名单策略</b>（目前只有
              <b>「轮回不止」</b>）。除非你把它写进目标策略里，否则永远不会被选中；万一三张卡全是
              黑名单策略且都刷不掉，程序会<b>停下并报错</b>，而不是硬选一张。
            </li>
            <li>云游戏有时长限制，挂机同样消耗；长时间无操作会被踢回首页。</li>
            <li>
              界面坐标是按 {GAME_VERSION} 量的，游戏改版后可能失效，表现为日志报「等待 xxx 超时」。
            </li>
            <li>
              <b>米哈游用户协议禁止第三方自动化工具</b>，使用本程序存在账号风险，请自行判断。
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
