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

## 다른 PC·Vercel에서 연결 유지

API 키와 OAuth 토큰은 비밀정보라 Git에 올리지 않습니다. `config/credentials/*`,
`.env.local`, `.vercel` 또한 의도적으로 Git에서 제외됩니다. 공용 연결 정보의
기준은 Vercel 환경변수입니다.

새 PC에서는 저장소를 clone한 뒤 Vercel 계정에 로그인하고 다음을 실행합니다.

```bash
npx vercel link --project upnunde-test
npm run env:pull
npm install
npm run dev
```

`env:pull`은 Vercel Development 환경변수를 `.env.local`로 내려받습니다. 다음 이름을
Production, Preview, Development에 같이 유지합니다.

- 앱: `APP_LOGIN_ID`, `APP_LOGIN_PASSWORD`, `APP_SESSION_SECRET`, `APP_CREDENTIALS_SECRET`
- AI·음성: `ANTHROPIC_API_KEY`, `HIGGSFIELD_API_KEY`, `TYPECAST_API_KEY`,
  `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`
- YouTube 검색: `YOUTUBE_DATA_API_KEY`
- YouTube 업로드: `YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET`,
  `YOUTUBE_OAUTH_REFRESH_TOKEN`, `YOUTUBE_OAUTH_CHANNEL_ID`,
  `YOUTUBE_OAUTH_CHANNEL_NAME`, `YOUTUBE_OAUTH_PROFILE_ID`

브라우저 설정 화면에서 저장한 키는 해당 브라우저의 암호화 쿠키일 수 있으므로,
모든 PC에서 공유할 키는 Vercel 환경변수에 등록합니다.
