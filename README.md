# 술래잡기 (Multiplayer Tag) 🏃

팩맨처럼 생긴 미로에서 즐기는 간단한 실시간 멀티플레이 술래잡기 게임입니다.
브라우저만 있으면 몇 명이든 같이 플레이할 수 있어요.

## 특징

- 🟦 **팩맨 스타일 미로** — 파란 블록 미로 안에서 도망치고 쫓습니다.
- 👀 **3인칭 탑다운 시점** — 내 캐릭터 머리 위에서 내려다보는 시점.
- 👥 **인원 제한 없음** — 접속하는 사람 수에 맞춰 방에 들어갑니다.
- 🗺️ **자동 맵 확장** — 플레이어가 많아질수록 맵이 더 넓어집니다.
- 👹 **술래 잡기** — 술래가 다른 사람 몸에 닿은 채로 버튼을 누르면 잡힙니다.
- ⏱️ **10초 대기** — 잡힌 사람은 그 자리에서 10초 기다린 뒤 **새로운 술래**가 됩니다.

## 실행 방법

```bash
npm install
npm start
```

브라우저에서 `http://localhost:3000` 으로 접속하세요.
여러 명이 함께 하려면 같은 네트워크에서 서버 PC의 IP(`http://<서버IP>:3000`)로 접속하면 됩니다.
포트는 환경변수 `PORT` 로 바꿀 수 있습니다.

## 조작법

| 동작 | 키 |
| --- | --- |
| 이동 | 방향키 또는 `W` `A` `S` `D` |
| 잡기 (술래일 때) | `Space` 또는 화면의 `CATCH` 버튼 |

모바일/터치 기기에서는 화면 좌측의 방향 패드와 우측의 `CATCH` 버튼을 사용합니다.

## 게임 규칙

1. 게임에 들어오면 한 명이 **술래(👹, 빨간 테두리)**가 됩니다.
2. 술래는 도망치는 사람의 몸에 **닿은 상태**에서 잡기 버튼(`Space`)을 누릅니다.
3. 잡힌 사람은 그 자리에 **10초 동안 얼어붙고**, 머리 위에 남은 시간이 표시됩니다.
4. 그 사이 기존 술래는 자유로워지고, **10초가 지나면 잡혔던 사람이 새 술래**가 됩니다.
5. 이 과정을 반복하며 계속 즐기면 됩니다!

## 인터넷에 배포하기 (무료)

이 게임은 상시 실행되는 Node.js + WebSocket 서버가 필요하므로 GitHub Pages
같은 정적 호스팅으로는 동작하지 않습니다. 아래 호스팅 중 하나에 올리면
누구나 접속할 수 있는 공개 URL이 생깁니다. WebSocket을 지원하고 `PORT`
환경변수를 자동으로 주입하므로 별도 설정 없이 바로 동작합니다.

### 방법 1) Render (추천 · 카드/CLI 불필요)

이 레포에는 `render.yaml`(Blueprint)이 포함되어 있어 클릭 몇 번이면 됩니다.

1. <https://render.com> 가입 후 GitHub 계정 연결
2. **New → Blueprint** 선택
3. 이 레포(`playing-tag`)를 고르면 `render.yaml`을 자동 인식 → **Apply**
4. 배포가 끝나면 `https://playing-tag-xxxx.onrender.com` 같은 공개 주소가 생깁니다

> 무료 플랜은 일정 시간 접속이 없으면 서버가 잠들고, 다음 접속 때 다시 깨어나는 데
> 몇 초 걸릴 수 있습니다.

### 방법 2) Railway

1. <https://railway.app> 가입 → **New Project → Deploy from GitHub repo**
2. 이 레포 선택 (Node 앱으로 자동 인식, `Procfile` 사용)
3. 생성된 도메인에서 **Settings → Networking → Generate Domain** 으로 공개 URL 발급

### 방법 3) Docker (Fly.io 등 컨테이너 호스팅)

레포의 `Dockerfile` 로 어디서든 컨테이너로 띄울 수 있습니다.

```bash
docker build -t playing-tag .
docker run -p 3000:3000 playing-tag
```

## 구조

- `server.js` — Node.js HTTP + WebSocket 서버. 게임 상태, 미로 생성, 충돌/잡기 판정을 담당합니다 (서버 권위 방식).
- `public/index.html`, `public/client.js`, `public/style.css` — 캔버스 기반 클라이언트(렌더링, 입력, 카메라).

의존성은 WebSocket 라이브러리 [`ws`](https://www.npmjs.com/package/ws) 하나뿐입니다.
