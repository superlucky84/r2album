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
  - 드래그 앤 드롭 다중 업로드(동시성 3 큐), 절감률 표시, 이미지 메타데이터 인라인 수정, **다중 선택 일괄 앨범 이동 · 일괄 태그 추가/제거 · 원클릭 태그 제거**, 단건/일괄 삭제, 앨범 CRUD, 10GB 사용량 게이지 & **9.5 GB 과금 방지 업로드 하드캡**
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

## 설정 파일 구조 (혼동 주의)

개인 D1 ID · 이메일 · OAuth 비밀키가 Git에 올라가지 않도록 **템플릿 파일만 Git에서 관리**하고, 실제 설정 파일은 `.gitignore`로 제외합니다.

| 파일 | Git 추적 | 용도 | 비고 |
|---|---|---|---|
| `wrangler.example.jsonc` | ✅ 포함 | Wrangler 설정 템플릿 | 클론 후 `wrangler.jsonc`로 복사해서 사용 |
| `wrangler.jsonc` | ❌ `.gitignore` | 실제 D1 ID, 운영 `APP_ORIGIN`, `BOOTSTRAP_ADMIN_EMAIL` | 로컬·배포 시 사용 (커밋 금지) |
| `.dev.vars.example` | ✅ 포함 | 로컬 개발용 시크릿 템플릿 | 클론 후 `.dev.vars`로 복사해서 사용 |
| `.dev.vars` | ❌ `.gitignore` | **로컬 개발 서버(`pnpm dev`) 전용** 시크릿/변수 | `pnpm deploy`에서는 완전히 무시됨 (운영은 Cloudflare Secrets 사용) |

---

## 로컬 개발 환경 설정

### 사전 요구사항
- Node.js `v22+`
- `pnpm`

### 1. 의존성 설치 및 로컬 설정 파일 생성

```bash
pnpm install
cp wrangler.example.jsonc wrangler.jsonc
cp .dev.vars.example .dev.vars
```

`.dev.vars` 파일에 로컬 테스트용 Google OAuth 자격 증명과 세션 시크릿을 입력합니다.

```env
GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
SESSION_SECRET=replace-with-at-least-32-random-characters
# wrangler.jsonc에 운영 HTTPS APP_ORIGIN을 넣어 둔 상태에서도 로컬 dev를 편하게 돌리려면 아래 줄 추가:
APP_ORIGIN=http://localhost:5173
```

세션 시크릿 생성 예시:

```bash
openssl rand -base64 32
```

`wrangler.jsonc`의 `vars.BOOTSTRAP_ADMIN_EMAIL`을 본인 Google 이메일로 변경합니다.

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
# wrangler.jsonc가 없어도 wrangler.example.jsonc를 자동 사용해 실행됩니다.
pnpm test:e2e:local
```

---

## Cloudflare 프로덕션 최초 배포 가이드

### 1. Cloudflare 로그인 및 리소스 생성

> **R2 사전 활성화 안내:** Cloudflare 계정에서 R2를 한 번도 사용한 적이 없다면, 먼저 [Cloudflare Dashboard](https://dash.cloudflare.com/) → **R2 Object Storage**에서 최초 1회 R2 활성화를 완료해야 합니다. 미활성화 상태에서 CLI를 실행하면 `Please enable R2 through the Cloudflare Dashboard [code: 10042]` 오류가 발생합니다.

```bash
pnpm exec wrangler login

# D1 데이터베이스 생성
pnpm exec wrangler d1 create r2album-db

# R2 버킷 생성 (Public Access는 반드시 비활성화 상태 유지)
pnpm exec wrangler r2 bucket create r2album-media
```

- `wrangler d1 create r2album-db` 출력 결과의 `database_id`를 `wrangler.jsonc`의 `d1_databases[0].database_id`에 반영합니다.
- 참고: CLI가 `wrangler.jsonc`에 추가 바인딩을 자동 삽입할 수 있습니다. 앱 코드는 `DB`와 `MEDIA_BUCKET` 바인딩만 사용하므로 중복 바인딩은 정리해 두면 깔끔합니다.

### 2. `wrangler.jsonc` 운영 변수 수정

Cloudflare Dashboard → **Workers & Pages**에서 본인의 `*.workers.dev` 서브도메인을 확인하거나 커스텀 도메인을 준비한 뒤 `wrangler.jsonc`의 `vars`를 수정합니다. (**끝에 `/` 없이** 입력)

```jsonc
"vars": {
  "APP_ORIGIN": "https://r2album.<your-subdomain>.workers.dev",
  "BOOTSTRAP_ADMIN_EMAIL": "your-email@gmail.com"
}
```

### 3. Google Cloud Console OAuth 2.0 설정

1. Google Cloud Console → **APIs & Services → Credentials → Create Credentials → OAuth client ID (Web application)**
2. **Authorized JavaScript origins**:
   - 로컬: `http://localhost:5173`
   - 운영: `https://r2album.<your-subdomain>.workers.dev` (또는 커스텀 도메인)
3. **Authorized redirect URIs**:
   - 로컬: `http://localhost:5173/auth/google/callback`
   - 운영: `https://r2album.<your-subdomain>.workers.dev/auth/google/callback`

### 4. Workers Secrets 등록 & 원격 D1 마이그레이션

> **주의:** 아래 명령어에는 **시크릿 키 이름 그대로** 입력하고, `? Enter a secret value: ›` 프롬프트가 뜨면 그때 실제 값을 붙여넣고 엔터를 누릅니다.

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

> 참고: 사내 네트워크/방화벽 환경에 따라 `*.workers.dev` 도메인 접속이 차단되어 있을 수 있습니다. 배포 직후 PC에서 접속이 안 될 경우 모바일 LTE/5G에서 접속해 확인하거나 커스텀 도메인을 연결하세요.

### 6. 배포 후 수동 검증

배포된 HTTPS 도메인에서 [`docs/MANUAL_TEST_CHECKLIST.md`](./docs/MANUAL_TEST_CHECKLIST.md)의 `M-1` ~ `M-11` 항목을 순서대로 확인합니다.

---

## 운영 중 코드 수정 · 재배포 · 다른 PC에서 작업하기

### 평소 코드 수정 후 재배포
이미 Cloudflare에 저장된 D1 데이터, R2 사진, Secrets, Google OAuth 설정은 그대로 유지됩니다.
```bash
pnpm deploy
```
(`migrations/`에 새 SQL 마이그레이션이 추가된 경우에만 `pnpm db:migrate:remote && pnpm deploy` 실행)

### 다른 PC(집 등)에서 새로 클론해 배포할 때
Cloudflare 리소스 · Secrets · Google OAuth는 다시 설정할 필요가 없습니다.
1. `pnpm install && pnpm exec wrangler login`
2. `cp wrangler.example.jsonc wrangler.jsonc` 후 본인의 `database_id`, `APP_ORIGIN`, `BOOTSTRAP_ADMIN_EMAIL` 3개 값 입력
3. `pnpm deploy` (로컬 개발 서버 `pnpm dev`를 띄울 때만 `.dev.vars` 추가 생성)

---

## 무료 티어 과금 방지 안전장치

- **R2 저장 용량 하드캡 (기본 `9.5 GB` / `9,500,000,000 bytes`)**:
  - Cloudflare R2 무료 티어(10 GB)를 넘기지 않도록 `POST /api/admin/images`에서 R2 기록 전에 누적 용량을 검사해 `9.5 GB` 초과 시 **`507 STORAGE_LIMIT_EXCEEDED`** 로 업로드를 자동 차단합니다. (필요 시 `wrangler.jsonc`의 `vars.MAX_STORAGE_BYTES`로 바이트 단위 조정 가능)
- **무단 트래픽 R2 차단 & 브라우저 영구 캐시**:
  - 비로그인 요청은 세션 쿠키 검증 단계에서 `401`로 즉시 차단되어 R2를 호출하지 않습니다.
  - 인증된 이미지 응답에는 `Cache-Control: private, max-age=31536000, immutable` + `ETag`/`304`가 적용되어 반복 조회 트래픽을 최소화합니다.
- **권장 추가 설정**:
  - Workers **Free 플랜** 유지 시 일 10만 요청 초과하면 과금 없이 자동 차단됩니다.
  - Cloudflare Dashboard → **Notifications → Add → Billing / Usage Based Billing**에서 R2 사용량 알림을 켜두는 것을 권장합니다.
