/**
 * 데스크탑 자동 업데이트 체크
 *
 * tauri-plugin-updater로 GitHub Releases의 latest.json을 조회한다.
 * Android는 zapstore로 배포하므로 호출하지 않는다.
 */
import { isDesktop } from '../platform/detect'

export interface PendingUpdate {
  version: string
  currentVersion: string
  notes: string | undefined
  download: (onProgress?: (downloaded: number, total: number | undefined) => void) => Promise<void>
  installAndRelaunch: () => Promise<void>
}

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000

let _started = false

export async function checkOnce(): Promise<PendingUpdate | null> {
  if (!isDesktop()) return null

  const { check } = await import('@tauri-apps/plugin-updater')
  const update = await check()
  if (!update) return null

  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body,
    download: async (onProgress) => {
      let downloaded = 0
      let total: number | undefined
      await update.download((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? undefined
          onProgress?.(0, total)
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength
          onProgress?.(downloaded, total)
        }
      })
    },
    installAndRelaunch: async () => {
      await update.install()
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
    },
  }
}

export function startUpdateChecker(onFound: (update: PendingUpdate) => void): () => void {
  if (!isDesktop() || _started) return () => {}
  _started = true

  let cancelled = false

  const tick = async () => {
    try {
      const update = await checkOnce()
      if (update && !cancelled) onFound(update)
    } catch (err) {
      console.warn('[updater] check failed', err)
    }
  }

  void tick()
  const id = setInterval(tick, CHECK_INTERVAL_MS)

  return () => {
    cancelled = true
    clearInterval(id)
    _started = false
  }
}
