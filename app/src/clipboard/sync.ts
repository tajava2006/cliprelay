/**
 * 싱크 엔진 — 클립보드 동기화의 중앙 컨트롤러
 *
 * App.tsx에 흩어져 있던 디스커버리(릴레이/Blossom/프로필) 구독, 클립보드 구독,
 * 클립보드 모니터, 헬스체크를 한 곳에 모았다.
 *
 * 외부(App.tsx)는 SyncEngine 인스턴스를 만들어 start/stop만 호출하고,
 * 변경 알림(릴레이·서버·프로필)은 콜백으로 받는다.
 */
import {
  subscribeWriteRelays, subscribeBlossomServers, subscribeProfile,
} from '@cliprelay/shared'
import type { UserProfile } from '@cliprelay/shared'
import { saveWriteRelays } from '../store/relay-store'
import { saveBlossomServers } from '../store/blossom-store'
import { saveProfile } from '../store/profile-store'
import { getSharedPool } from '../nostr/pool'
import { startClipboardSubscription, type ClipboardSubscription } from '../nostr/subscribe'
import { startPlatformClipboardMonitor } from '../platform/clipboard'
import { startNativeSubscription } from '../platform/android/foreground-service'
import { publishClipboard } from '../nostr/publish'
import { rgbaToPng, uploadImage } from '../blossom/upload'
import type { ClipboardMonitor } from './monitor'
import { fingerprintPng } from './fingerprint'

const HEALTH_INTERVAL_MS = 15_000
const RESTART_COOLDOWN_MS = 10_000

export interface SyncEngineOpts {
  userPubkey: string
  writeRelays: string[]
  blossomServers: string[]
  onWriteRelaysChange?: (relays: string[]) => void
  onBlossomServersChange?: (servers: string[]) => void
  onProfileChange?: (profile: UserProfile) => void
}

export class SyncEngine {
  private userPubkey: string
  private writeRelays: string[]
  private blossomServers: string[]
  private onWriteRelaysChange?: (relays: string[]) => void
  private onBlossomServersChange?: (servers: string[]) => void
  private onProfileChange?: (profile: UserProfile) => void

  private relaySubCleanup: (() => void) | null = null
  private blossomSubCleanup: (() => void) | null = null
  private profileSubCleanup: (() => void) | null = null
  private clipboardSub: ClipboardSubscription | null = null
  private monitor: ClipboardMonitor | null = null
  private healthCheckHandle: ReturnType<typeof setInterval> | null = null

  private lastSyncedText: string = ''
  private lastSyncedImageFp: string = ''
  private isPublishing: boolean = false
  private lastSubRestart: number = 0

  constructor(opts: SyncEngineOpts) {
    this.userPubkey = opts.userPubkey
    this.writeRelays = opts.writeRelays
    this.blossomServers = opts.blossomServers
    this.onWriteRelaysChange = opts.onWriteRelaysChange
    this.onBlossomServersChange = opts.onBlossomServersChange
    this.onProfileChange = opts.onProfileChange
  }

  async start(): Promise<void> {
    this.startRelayDiscovery()
    this.startBlossomDiscovery()
    this.startProfileDiscovery()
    await this.startMonitor()
    this.startHealthCheck()
  }

  stop(): void {
    if (this.healthCheckHandle) { clearInterval(this.healthCheckHandle); this.healthCheckHandle = null }
    this.relaySubCleanup?.(); this.relaySubCleanup = null
    this.blossomSubCleanup?.(); this.blossomSubCleanup = null
    this.profileSubCleanup?.(); this.profileSubCleanup = null
    this.clipboardSub?.close(); this.clipboardSub = null
    this.monitor?.stop(); this.monitor = null
  }

  /** 모든 구독을 즉시 재시작 (포그라운드 복귀·네트워크 복구 시) */
  restartAll(): void {
    console.log('[sync] restarting all subscriptions')
    this.startRelayDiscovery()
    this.startBlossomDiscovery()
    this.startProfileDiscovery()
    this.restartClipboardSubscription()
  }

  /** 클립보드 구독이 죽었으면 쿨다운(10초) 안에서 전체 재시작. 발행 중이면 건너뜀. */
  maybeRestartIfDead(): void {
    if (this.clipboardSub?.isAlive()) return
    if (this.isPublishing) return
    const now = Date.now()
    if (now - this.lastSubRestart <= RESTART_COOLDOWN_MS) return
    this.lastSubRestart = now
    console.warn('[sync] subscription not alive — restarting all subscriptions')
    this.restartAll()
  }

  getRelayStatus(): Promise<Record<string, boolean>> {
    return this.clipboardSub?.getRelayStatus() ?? Promise.resolve({})
  }

  /** History에서 텍스트 클릭 시 클립보드에 쓴 후 monitor에 알린다 (자기쓰기 무시용) */
  setMonitorLastKnownText(text: string): void { this.monitor?.setLastKnown(text) }
  setMonitorLastKnownImageFingerprint(fp: string): void { this.monitor?.setLastKnownImageFingerprint(fp) }

  // Android lifecycle (publish 루프)에서 사용
  getWriteRelays(): string[] { return this.writeRelays }
  getBlossomServers(): string[] { return this.blossomServers }
  getIsPublishing(): boolean { return this.isPublishing }
  setIsPublishing(v: boolean): void { this.isPublishing = v }
  getLastSyncedText(): string { return this.lastSyncedText }
  setLastSyncedText(v: string): void { this.lastSyncedText = v }
  getLastSyncedImageFp(): string { return this.lastSyncedImageFp }
  setLastSyncedImageFp(v: string): void { this.lastSyncedImageFp = v }

  private startRelayDiscovery(): void {
    this.relaySubCleanup?.()
    this.relaySubCleanup = subscribeWriteRelays(this.userPubkey, relays => {
      void saveWriteRelays(relays)
      const changed = !(this.writeRelays.length === relays.length && this.writeRelays.every((r, i) => r === relays[i]))
      this.writeRelays = relays
      if (changed) this.onWriteRelaysChange?.(relays)
      // write 릴레이 변경 시 Blossom·프로필·클립보드 구독도 새 릴레이로 재생성
      this.startBlossomDiscovery()
      this.startProfileDiscovery()
      this.restartClipboardSubscription()
      // Android: 네이티브 OkHttp 구독을 새 릴레이로 재시작
      void startNativeSubscription(relays, this.userPubkey).catch(err => console.warn('[native-sub] relay change restart failed:', err))
    }, getSharedPool())
  }

  private startBlossomDiscovery(): void {
    this.blossomSubCleanup?.()
    this.blossomSubCleanup = subscribeBlossomServers(this.userPubkey, this.writeRelays, servers => {
      void saveBlossomServers(servers)
      this.blossomServers = servers
      this.onBlossomServersChange?.(servers)
    }, getSharedPool())
  }

  private startProfileDiscovery(): void {
    this.profileSubCleanup?.()
    this.profileSubCleanup = subscribeProfile(this.userPubkey, this.writeRelays, profile => {
      void saveProfile(profile)
      this.onProfileChange?.(profile)
    }, getSharedPool())
  }

  private restartClipboardSubscription(): void {
    this.clipboardSub?.close()
    this.clipboardSub = startClipboardSubscription(
      this.userPubkey,
      this.writeRelays,
      text => {
        this.monitor?.setLastKnown(text)
        this.lastSyncedText = text
      },
      (fp, pngBytes) => {
        this.monitor?.setLastKnownImageFingerprint(fp)
        this.lastSyncedImageFp = fingerprintPng(pngBytes)
      },
    )
  }

  private async startMonitor(): Promise<void> {
    this.monitor?.stop()
    this.monitor = await startPlatformClipboardMonitor(
      (text: string) => {
        void publishClipboard(
          { type: 'text', content: text },
          this.writeRelays,
        ).catch(err => console.error('[monitor] text publish failed:', err))
      },
      (rgba: Uint8Array, width: number, height: number) => {
        void (async () => {
          const servers = this.blossomServers
          if (servers.length === 0) {
            console.warn('[monitor] no Blossom servers — skipping image publish')
            return
          }
          try {
            const pngBytes = await rgbaToPng(rgba, width, height)
            const payload = await uploadImage(pngBytes, servers)
            await publishClipboard(payload, this.writeRelays)
          } catch (err) {
            console.error('[monitor] image publish failed:', err)
          }
        })()
      },
    )
    // 수신한 텍스트를 클립보드에 썼을 때 재발행 루프 방지
    this.restartClipboardSubscription()
  }

  private startHealthCheck(): void {
    if (this.healthCheckHandle) clearInterval(this.healthCheckHandle)
    // 15초 주기 — EOSE를 못 받았거나 CLOSED된 경우 전체 구독 재시작
    this.healthCheckHandle = setInterval(() => this.maybeRestartIfDead(), HEALTH_INTERVAL_MS)
  }
}
