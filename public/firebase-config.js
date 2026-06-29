// ============================================================================
//  Firebase 설정
//
//  이 값들은 Firebase 웹 앱에 공개적으로 포함되는 클라이언트 설정값입니다
//  (비밀 키가 아닙니다). 데이터 보호는 Realtime Database 보안 규칙으로 합니다.
//
//  Realtime Database 위치: asia-southeast1 (싱가포르)
// ============================================================================
export const firebaseConfig = {
  apiKey: "AIzaSyD5ODI_9Hp038GgEl3r5Qg1tmLnrjx2LZM",
  authDomain: "gen-lang-client-0055642025.firebaseapp.com",
  databaseURL: "https://gen-lang-client-0055642025-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "gen-lang-client-0055642025",
  storageBucket: "gen-lang-client-0055642025.firebasestorage.app",
  messagingSenderId: "469310119181",
  appId: "1:469310119181:web:6fef71a25fe7d6eff5e444",
  measurementId: "G-NV7XTKVBZW",
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
