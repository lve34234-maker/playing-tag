// ============================================================================
//  Firebase 설정
//  여기에 본인 Firebase 프로젝트의 설정값을 붙여넣으세요.
//
//  Firebase 콘솔(https://console.firebase.google.com) →
//    프로젝트 설정(⚙️) → 일반 → 내 앱 → "웹 앱" 의 SDK 설정 및 구성에서
//    아래 값들을 복사할 수 있습니다.
//
//  ⚠️ Realtime Database 를 만들었다면 databaseURL 도 꼭 채워주세요.
//     (예: https://내프로젝트-default-rtdb.firebaseio.com)
//
//  값을 채우기 전에는 게임이 "오프라인 솔로 모드"로 동작합니다(혼자 미로 미리보기).
// ============================================================================
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  appId: "YOUR_APP_ID",
};

// 설정값이 실제로 채워졌는지 검사합니다 (placeholder 여부 확인).
export function isConfigured(cfg) {
  return (
    !!cfg.apiKey &&
    !cfg.apiKey.startsWith("YOUR_") &&
    !!cfg.databaseURL &&
    !cfg.databaseURL.includes("YOUR_PROJECT")
  );
}
