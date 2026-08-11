import type { Page } from 'playwright';
import { grabToFile } from './core/capture.ts';
import { report } from './core/context.ts';

/** Why the bot handed control back to the user. Every one of these ends the session. */
export type StopReason = 'target-found' | 'run-in-progress' | 'stuck' | 'cancelled';

const MESSAGES: Record<StopReason, string> = {
  'target-found': '已刷到目标，游戏标签页已关闭',
  'run-in-progress': '活动页有未结算的玩家对局，浏览器已保留，请手动处理后再启动',
  stuck: '连续多轮无法识别界面，可能掉线或卡住，浏览器已保留',
  cancelled: '已手动停止，浏览器已保留',
};

/** Leading tag of each stop line. The UI colours the stream by it, so keep these distinct. */
const TAGS: Record<StopReason, string> = {
  'target-found': '完成',
  'run-in-progress': '停止',
  stuck: '停止',
  cancelled: '已停止',
};

/** Desktop delivery is left to the Electron shell; here the terminal bell is enough. */
export function notify(reason: StopReason, detail?: string): void {
  report(`${TAGS[reason]}: ${MESSAGES[reason]}${detail ? ` - ${detail}` : ''}`);
  process.stdout.write('\x07');
}

/** Closes the game tab and says why. The browser context is left alive on purpose. */
export async function stop(page: Page, reason: StopReason, detail?: string): Promise<void> {
  notify(reason, detail);
  if (page.isClosed()) return;

  try {
    report(`现场截图: ${await grabToFile(page, `stop-${reason}-${Date.now()}`)}`);
  } catch (error) {
    // A dead stream is exactly when grabbing fails, which is itself worth knowing about.
    report(`截图失败: ${error instanceof Error ? error.message : String(error)}`);
  }
  // Closing the tab stops the cloud clock, but the other two reasons need the screen left up.
  if (reason === 'target-found') await page.close();
}
