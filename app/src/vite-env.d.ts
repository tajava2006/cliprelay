/// <reference types="vite/client" />

/** 빌드 시점 git 커밋 해시 (vite define 주입, 미커밋 변경 시 -dirty) */
declare const __COMMIT_HASH__: string
/** app/package.json의 version (vite define 주입) */
declare const __APP_VERSION__: string
