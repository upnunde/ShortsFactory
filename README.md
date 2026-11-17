# 쇼츠 스튜디오

로컬에서 쇼츠 대본을 검수하는 웹 작업실입니다. 화면은 HeroUI를 씁니다.

```bash
npm run dev
```

컴포넌트는 `@heroui/react`에서 직접 가져옵니다.

## 간단 로그인

별도 회원 데이터베이스 없이 서버 환경변수의 단일 계정으로 앱 전체를 잠급니다.

```bash
APP_LOGIN_ID=발급할_아이디
APP_LOGIN_PASSWORD=발급할_비밀번호
APP_SESSION_SECRET=충분히_긴_임의의_문자열
```

세 값은 Vercel의 Production 환경변수에도 동일하게 등록해야 합니다. 로그인하지
않은 페이지 요청은 `/login`으로 이동하고, API 요청은 `401`을 반환합니다.
