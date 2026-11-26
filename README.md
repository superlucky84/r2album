# r2album

Cloudflare R2(무료 10GB, 송신 트래픽 무료) + Cloudflare D1 + Cloudflare Workers 올인원 구조로 운영되는 **프라이빗 클라우드 포토 앨범 & 전체화면 디지털 액자** 애플리케이션입니다.

## 주요 기능

- **Google OAuth 2.0 + 가족 가입 승인 (`admin` / `viewer`)**:
  - `BOOTSTRAP_ADMIN_EMAIL` 최초 관리자 + D1 `allowed_users` 기반 실시간 권한 관리
  - 미등록 Google 계정은 로그인 시도 시 `pending` 가입 신청으로 접수되며, 관리자 승인 전까지 세션이 발급되지 않음
- **Private R2 미디어 스트리밍**:
  - R2 버킷은 퍼블릭 비공개 유지, `/api/media/:variant/:id`에서 세션 검증 후 `Cache-Control: private, max-age=31536000, immutable` + `ETag`/`304`로 서빙
- **브라우저 EXIF 추출 & WebP 2종 변환 업로드 (`/admin`)**:
  - 업로드 전 브라우저에서 JPEG EXIF(`DateTimeOriginal`/`CreateDate`, `Orientation`)를 추출하고 표시용 WebP(최대 2048px, `q=0.82`) + 썸네일 WebP(최대 480px, `q=0.75`)로 변환
  - 드래그 앤 드롭 다중 업로드(동시성 3 큐), 절감률 표시, 이미지 메타데이터 인라인 수정, 단건/일괄 삭제, 앨범 CRUD, 10GB 사용량 게이지
- **Virtual Scroll 갤러리 & 라이트박스 (`/`)**:
  - `CHUNK_SIZE = 40` 구간 Lazy Fetch + 메모리 캐시 + 앨범/태그 필터 + 키보드/스와이프 지원 라이트박스
- **전체화면 액자 롤링 모드 (`PhotoFrameMode`)**:
  - 현재 필터 범위 기준 더블 버퍼링(`layerA`/`layerB`) 프리로드 크로스페이드, 선택적 Ken Burns 줌, 순차/중복 없는 Fisher-Yates 랜덤 셔플, 간격(`3s`/`5s`/`10s`/`30s`), Fullscreen & Screen Wake Lock, 3초 무조작 HUD 자동 숨김

---

## 문서 안내

- 요구사항 명세: [`docs/REQUIREMENTS.md`](./docs/REQUIREMENTS.md)
- 아키텍처 및 API 설계: [`docs/DESIGN.md`](./docs/DESIGN.md)
- 단계별 구현 계획: [`docs/IMPLEMENT.md`](./docs/IMPLEMENT.md)
- 배포 전 수동 테스트 체크리스트: [`docs/MANUAL_TEST_CHECKLIST.md`](./docs/MANUAL_TEST_CHECKLIST.md)

---

## 로컬 개발 환경 설정

### 사전 요구사항
- Node.js `v22+`
- `pnpm`

### 1. 의존성 설치 및 환경 변수 구성

```bash
pnpm install
cp .dev.vars.example .dev.vars
```

`.dev.vars` 파일에 로컬 테스트용 Google OAuth 자격 증명과 세션 시크릿을 입력합니다. (`.dev.vars`는 `.gitignore`에 포함되어 있으며 절대 커밋하지 마세요.)

```env
GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
SESSION_SECRET=replace-with-at-least-32-random-characters
```

세션 시크릿 생성 예시:

```bash
openssl rand -base64 32
```

### 2. 로컬 D1 마이그레이션 적용

```bash
pnpm db:migrate:local
```

### 3. 개발 서버 실행

`vite`(프론트 HMR + `/api`, `/auth` 프록시)와 `wrangler dev --port 8787`(로컬 Worker + Miniflare D1/R2)를 함께 실행합니다.

```bash
pnpm dev
```

브라우저에서 `http://localhost:5173`으로 접속합니다.

---

## 테스트 및 검증 명령어

```bash
# 포맷 · 타입 · 린트 검사
pnpm format:check
pnpm type-check
pnpm lint

# 단위 · 컴포넌트 · Worker 테스트 스위트
pnpm test

# 프로덕션 클라이언트 빌드
pnpm build

# 로컬 E2E 통합 테스트 (빌드된 dist/client + Wrangler Miniflare D1/R2)
pnpm test:e2e:local
```

---

## Cloudflare 프로덕션 배포 가이드

### 1. Cloudflare 로그인 및 리소스 생성

```bash
pnpm exec wrangler login

# D1 데이터베이스 생성
pnpm exec wrangler d1 create r2album-db

# R2 버킷 생성 (Public Access는 반드시 비활성화 상태 유지)
pnpm exec wrangler r2 bucket create r2album-media
```

`wrangler d1 create r2album-db` 출력 결과의 `database_id`를 `wrangler.jsonc`의 `d1_databases[0].database_id`에 반영합니다.

### 2. `wrangler.jsonc` 운영 변수 수정

`wrangler.jsonc`의 `vars`를 실제 도메인과 최초 관리자 Google 이메일로 변경합니다.

```jsonc
"vars": {
  "APP_ORIGIN": "https://album.your-domain.com",
  "BOOTSTRAP_ADMIN_EMAIL": "your-email@gmail.com"
}
```

### 3. Google Cloud Console OAuth 2.0 설정

1. Google Cloud Console → **APIs & Services → Credentials → Create Credentials → OAuth client ID (Web application)**
2. **Authorized JavaScript origins**:
   - 로컬: `http://localhost:5173`
   - 운영: `https://album.your-domain.com`
3. **Authorized redirect URIs**:
   - 로컬: `http://localhost:5173/auth/google/callback`
   - 운영: `https://album.your-domain.com/auth/google/callback`

### 4. Workers Secrets 등록 & 원격 D1 마이그레이션

```bash
pnpm exec wrangler secret put GOOGLE_CLIENT_ID
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET
pnpm exec wrangler secret put SESSION_SECRET

pnpm db:migrate:remote
```

### 5. 빌드 및 배포

```bash
pnpm deploy
```

### 6. 배포 후 수동 검증

배포된 HTTPS 도메인에서 [`docs/MANUAL_TEST_CHECKLIST.md`](./docs/MANUAL_TEST_CHECKLIST.md)의 `M-1` ~ `M-11` 항목을 순서대로 확인합니다.
