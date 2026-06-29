# 술래잡기 (Multiplayer Tag) 🏃

팩맨처럼 생긴 미로에서 즐기는 간단한 실시간 멀티플레이 술래잡기 게임입니다.
**서버 코드 없이** Firebase Realtime Database 로 실시간 동기화하고, **GitHub Pages**
로 인터넷에 자동 배포합니다.

## 특징

- 🟦 **팩맨 스타일 미로** — 파란 블록 미로 안에서 도망치고 쫓습니다.
- 👀 **3인칭 탑다운 시점** — 내 캐릭터 머리 위에서 내려다보는 시점.
- 👥 **인원 제한 없음** — 같은 주소에 접속한 모두가 함께 플레이.
- 🗺️ **자동 맵 확장** — 플레이어가 많아질수록 맵이 더 넓어집니다.
- 👹 **술래 잡기** — 술래가 다른 사람 몸에 닿은 채로 버튼을 누르면 잡힙니다.
- ⏱️ **10초 대기** — 잡힌 사람은 그 자리에서 10초 기다린 뒤 **새로운 술래**가 됩니다.
- ☁️ **서버리스** — 별도 서버 없이 Firebase 만으로 동작.

## 조작법

| 동작 | 키 |
| --- | --- |
| 이동 | 방향키 또는 `W` `A` `S` `D` |
| 잡기 (술래일 때) | `Space` 또는 화면의 `CATCH` 버튼 |

모바일/터치 기기에서는 화면 좌측의 방향 패드와 우측의 `CATCH` 버튼을 사용합니다.

## 🚀 인터넷에 올리기 (GitHub Pages 자동 배포)

호스팅은 **GitHub Pages** 가 담당하고, 실시간 동기화만 **Firebase Realtime
Database** 를 사용합니다. 게임 파일(`index.html` 등)이 저장소 **루트**에 있고
`.nojekyll` 가 있어서, GitHub Pages 가 푸시할 때마다 루트의 `index.html` 을
홈페이지로 **자동 배포**합니다. 별도의 `firebase deploy` 가 필요 없습니다.

> `firebase-config.js` 값을 채우기 전에는 페이지가 **오프라인 솔로 모드**로
> 동작합니다(혼자 미로를 미리 볼 수 있음). 멀티플레이를 하려면 아래 1~2단계가 필요합니다.

### 1. Firebase Realtime Database 만들기 (멀티플레이 동기화용)

> Firebase 는 *호스팅이 아니라* 실시간 DB 용도로만 씁니다.

1. <https://console.firebase.google.com> 접속 → **프로젝트 추가**
2. **빌드 → Realtime Database → 데이터베이스 만들기** → **테스트 모드**로 시작
   - (선택) 보안 규칙은 이 레포의 `database.rules.json` 내용을 콘솔의 **규칙** 탭에 붙여넣으면 됩니다.
3. **프로젝트 설정(⚙️) → 일반 → 내 앱 → 웹 앱(`</>`) 추가** 후 `firebaseConfig` 값을 복사

### 2. 설정값 채우기 + 커밋

`firebase-config.js` 에 복사한 값을 붙여넣습니다 (특히 `databaseURL` 포함):

```js
export const firebaseConfig = {
  apiKey: "...",
  authDomain: "내프로젝트.firebaseapp.com",
  databaseURL: "https://내프로젝트-default-rtdb.firebaseio.com",
  projectId: "내프로젝트",
  appId: "...",
};
```

그리고 변경사항을 `main` 에 커밋/푸시합니다:

```bash
git add firebase-config.js
git commit -m "Add Firebase config"
git push origin main
```

### 3. GitHub Pages 켜기 (최초 1회)

GitHub 레포 → **Settings → Pages → Build and deployment** 에서
**Source = `Deploy from a branch`**, **Branch = `main` / `/ (root)`** 로 설정합니다.

그 다음부터는 `main` 에 푸시할 때마다 자동 배포되고, 완료되면
**`https://<사용자명>.github.io/playing-tag/`** 주소로 누구나 접속할 수 있습니다. 🎮
(배포 상태는 레포의 **Actions** 탭의 "pages build and deployment" 에서 볼 수 있어요.)

## 게임 규칙

1. 게임에 들어오면 한 명이 **술래(👹, 빨간 테두리)**가 됩니다.
2. 술래는 도망치는 사람의 몸에 **닿은 상태**에서 잡기 버튼(`Space`)을 누릅니다.
3. 잡힌 사람은 그 자리에 **10초 동안 얼어붙고**, 머리 위에 남은 시간이 표시됩니다.
4. 그 사이 기존 술래는 자유로워지고, **10초가 지나면 잡혔던 사람이 새 술래**가 됩니다.
5. 이 과정을 반복하며 계속 즐기면 됩니다!

## 구조

- `index.html`, `client.js`, `style.css` — 캔버스 기반 클라이언트
  (렌더링, 입력, 카메라, 충돌, 잡기 판정). 미로는 인원수로부터 결정적으로 생성되어
  모든 클라이언트가 동일한 맵을 봅니다.
- `firebase-config.js` — 본인 Firebase 프로젝트 설정값.
- `.nojekyll` — GitHub Pages 가 Jekyll 처리 없이 파일을 그대로 서빙하도록 합니다.
- `database.rules.json` — Realtime Database 보안 규칙(콘솔에 붙여넣어 사용).
- `firebase.json`, `.firebaserc` — (선택) `firebase deploy` 로 Firebase Hosting 을
  쓰고 싶을 때를 위한 설정. GitHub Pages 만 쓸 경우 무시해도 됩니다.

### 보안 규칙에 대한 참고

기본 `database.rules.json` 은 캐주얼 게임을 쉽게 시작할 수 있도록 누구나 읽고 쓸 수
있게 열려 있습니다. 공개 운영 시에는 인증(Firebase Auth)을 붙이고 규칙을 더 좁히는
것을 권장합니다.
