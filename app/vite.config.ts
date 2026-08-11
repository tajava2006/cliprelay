import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import pkg from "./package.json";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// 빌드 시점의 git 커밋 해시 — UI 하단과 부팅 로그에 표시해 "지금 도는 게 어느
// 버전인지"를 식별한다 (dev/로컬빌드/릴리즈가 섞이는 관찰 기간에 필수).
// 미커밋 변경이 있으면 -dirty를 붙인다.
function gitCommitHash(): string {
  try {
    let hash = execSync("git rev-parse --short HEAD").toString().trim();
    if (execSync("git status --porcelain").toString().trim().length > 0) {
      hash += "-dirty";
    }
    return hash;
  } catch {
    return "unknown";
  }
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  define: {
    __COMMIT_HASH__: JSON.stringify(gitCommitHash()),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
