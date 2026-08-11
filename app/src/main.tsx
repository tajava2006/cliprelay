import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { logConn } from "./nostr/connlog";

// 부팅 마커 — 연결 로그에서 리로드/재시작 이벤트 뒤에 새 세션 시작점이 보이게 하고,
// 커밋 해시로 어느 빌드가 남긴 로그인지 식별한다
logConn(`app started (${__COMMIT_HASH__})`);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
