# r2album 구현 계획서 (IMPLEMENT)

> 관련 문서: [`REQUIREMENTS.md`](./REQUIREMENTS.md) | [`DESIGN.md`](./DESIGN.md) | [`MANUAL_TEST_CHECKLIST.md`](./MANUAL_TEST_CHECKLIST.md)
>
> **작성 규칙 (`doc-driven-designer-v1`):**
> - 모든 Phase는 `Refs:` 라인, 진입 조건(Entry Criteria), 구현 체크리스트, 기본 테스트(Baseline Tests), 종료 조건(Exit Criteria)을 포함한다.
> - `Files:` 블록은 계획 단계에서는 작성하지 않으며, 해당 Phase 구현 완료 시 git 상태(`git status --porcelain -uall`, `git diff --name-status`)를 기준으로 기록한다.
> - 모든 핵심 설계 결정(`DC-1` ~ `DC-15`)이 확정되었으며, 추후 계약 변경 시 문서를 먼저 갱신한 뒤 코드를 수정한다.

---

## Phase 1 — 프로젝트 스캐폴딩 & Cloudflare Workers/D1/R2 기반 구축: done

Refs: RQ-1, RQ-2, DC-1, DC-9, DC-10, M-10

### Entry Criteria
- `REQUIREMENTS.md`와 `DESIGN.md`의 기본 구조 합의 (`DC-10` 로컬 개발 구성 확인).
- Node.js (v22+) 및 pnpm 사용 가능.

### Implementation Checklist
- [x] `package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `.prettierrc`, `.gitignore` 초기화 (`lithent`, `@lithent/lithent-vite`, `@tailwindcss/vite`, `tailwindcss`, `hono`, `wrangler`, `vitest`, `@testing-library/dom`, `happy-dom` 포함; `.dev.vars` 및 `.wrangler/` git 제외).
- [x] `wrangler.jsonc` 구성 (Static Assets `./dist/client`, SPA fallback, `run_worker_first: ["/api/*", "/auth/*"]`, D1 `DB`, R2 `MEDIA_BUCKET`, Vars 스켈레톤) 및 `.dev.vars.example` 작성.
- [x] `src/worker/index.ts` 헬스체크(`GET /api/health`) 및 공통 에러 포맷(`{ error: { code, message } }`) 구축.
- [x] `src/client/index.tsx` Lithent 최소 앱 마운트 및 Vite 개발 프록시(`/api`, `/auth` → Wrangler) 연결.
- [x] `migrations/0001_init.sql` 작성 및 로컬 D1 마이그레이션 스크립트(`pnpm db:migrate:local`) 검증.

### Baseline Tests
- `pnpm type-check` 및 `pnpm lint` 통과.
- `pnpm build` (Vite SPA 빌드) 성공.
- Vitest + `lithent/test` 스모크 테스트 1건 및 Worker `/api/health` 단위 테스트 1건 통과.

### Exit Criteria
- 로컬에서 `vite` + `wrangler dev`로 Lithent SPA가 열리고 `/api/health` 응답(`200 OK`)이 확인된다.
- 로컬 D1 마이그레이션이 오류 없이 적용된다.

Files:
- `.dev.vars.example` (added)
- `.gitignore` (added)
- `.prettierrc` (added)
- `docs/IMPLEMENT.md` (modified)
- `eslint.config.js` (added)
- `index.html` (added)
- `migrations/0001_init.sql` (added)
- `package.json` (added)
- `pnpm-lock.yaml` (added)
- `pnpm-workspace.yaml` (added)
- `src/client/App.tsx` (added)
- `src/client/__tests__/App.test.tsx` (added)
- `src/client/index.css` (added)
- `src/client/index.tsx` (added)
- `src/shared/constants.ts` (added)
- `src/shared/types.ts` (added)
- `src/worker/__tests__/health.test.ts` (added)
- `src/worker/env.ts` (added)
- `src/worker/errors.ts` (added)
- `src/worker/index.ts` (added)
- `tsconfig.json` (added)
- `tsconfig.worker.json` (added)
- `vite.config.ts` (added)
- `vitest.config.ts` (added)
- `wrangler.jsonc` (added)

---

## Phase 2 — Google OAuth 2.0 인증, 세션 쿠키, RBAC & 가입 신청/승인 플로우: done

Refs: RQ-3, RQ-4, RQ-12, DC-3, DC-11, M-1, M-2, M-11

### Entry Criteria
- Phase 1 완료.
- `DC-3`(허용 이메일 관리 방식: `BOOTSTRAP_ADMIN_EMAIL` + D1 `allowed_users` vs 환경변수 전용) 최종 확정.

### Implementation Checklist
- [x] `src/worker/auth/session.ts`: Web Crypto API(`HMAC-SHA256`) 기반 세션 토큰 서명/검증 및 `HttpOnly; SameSite=Lax; Secure` 쿠키 헬퍼 구현(로컬 HTTP 개발 시 Secure 조건부 처리).
- [x] `src/worker/auth/google.ts`: PKCE + `state` 쿠키 기반 Google OAuth 인가 URL 생성, 토큰 교환, `email_verified` 검증 구현.
- [x] `src/worker/auth/middleware.ts`: `requireAuth`(`admin` | `viewer`), `requireAdmin`(`admin` 전용), 허용 목록 조회(`BOOTSTRAP_ADMIN_EMAIL` + D1 `allowed_users`) 구현.
- [x] `src/worker/routes/auth.ts`: `GET /auth/google`, `GET /auth/google/callback`, `POST /auth/logout`, `GET /api/me` 구현.
- [x] `src/client/components/LoginView.tsx` 및 인증 가드/클라이언트 라우터(`/`, `/admin`, `/login`) 구현 (`viewer`의 `/admin` 진입 차단 및 비인가 오류 안내 포함).
- [x] `migrations/0002_user_approval.sql` 추가(`allowed_users.status`, `name`, `updated_at`), OAuth 콜백의 미등록 계정 `pending` 자동 등록(대기열 100명 상한) 및 `approved` 전용 세션 검증, `LoginView` 승인 대기(`/login?status=pending`)·거절(`/login?error=rejected`) 안내 UI 반영.

### Baseline Tests
- 세션 토큰 서명/검증/만료/변조 거부 단위 테스트.
- OAuth `state` 불일치, `email_verified: false`, 비허용 이메일(`403`), `viewer`의 `/api/admin/*` 접근(`403`), 미인증 `/api/images` 접근(`401`) 테스트.
- `LoginView` Lithent 컴포넌트 렌더링/오류 표시 테스트.

### Exit Criteria
- 미인증 사용자는 모든 데이터·미디어 API에서 `401`을 받고 로그인 화면으로 안내된다.
- `admin`과 `viewer`의 권한 경계가 서버 미들웨어와 클라이언트 라우터 모두에서 동작한다.

Files:
- `docs/DESIGN.md` (modified)
- `docs/IMPLEMENT.md` (modified)
- `docs/MANUAL_TEST_CHECKLIST.md` (modified)
- `docs/REQUIREMENTS.md` (modified)
- `migrations/0002_user_approval.sql` (added)
- `src/client/App.tsx` (modified)
- `src/client/__tests__/App.test.tsx` (modified)
- `src/client/__tests__/LoginView.test.tsx` (added)
- `src/client/api/client.ts` (added)
- `src/client/components/LoginView.tsx` (added)
- `src/client/lib/router.ts` (added)
- `src/shared/constants.ts` (modified)
- `src/shared/types.ts` (modified)
- `src/worker/__tests__/auth.test.ts` (added)
- `src/worker/__tests__/session.test.ts` (added)
- `src/worker/auth/google.ts` (added)
- `src/worker/auth/middleware.ts` (added)
- `src/worker/auth/session.ts` (added)
- `src/worker/index.ts` (modified)
- `src/worker/routes/auth.ts` (added)

---

## Phase 3 — 이미지 메타데이터/업로드/삭제 API & Private R2 미디어 서빙: done

Refs: RQ-4, RQ-5, RQ-6, RQ-7, RQ-12, DC-4, DC-5, DC-6, DC-11, M-3, M-4, M-5, M-11

### Entry Criteria
- Phase 2 완료.
- `DC-5`(Worker R2 네이티브 바인딩 업로드 vs Presigned URL) 최종 확정.

### Implementation Checklist
- [x] `src/worker/routes/media.ts`: `GET /api/media/:variant/:id` (`requireAuth`, R2 객체 조회, `ETag`/`If-None-Match` 304 지원, `Cache-Control: private, max-age=31536000, immutable`).
- [x] `src/worker/routes/admin.ts`:
  - `POST /api/admin/images`: `image/webp` 매직 바이트 및 크기 검증(`display <= 5MB`, `thumb <= 512KB`), R2 2종 저장 + D1 `images`/`tags`/`image_tags` 기록, D1 실패 시 R2 롤백 삭제.
  - `PATCH /api/admin/images/:id`: 캡션, 앨범, 태그, `takenAt` 수정.
  - `DELETE /api/admin/images/:id` 및 `POST /api/admin/images/bulk-delete`: D1 및 R2 객체 동시 삭제.
  - `/api/admin/albums`, `/api/admin/users` (조회·직접 등록·승인/거절/역할 변경 `PATCH`·삭제 및 `BOOTSTRAP_ADMIN_EMAIL` 보호 포함), `/api/admin/stats` 구현.
- [x] `src/worker/routes/images.ts`:
  - `GET /api/images`: `offset`, `limit`(최대 100 clamp), `albumId`, `tag` 지원, `ORDER BY taken_at DESC, id DESC` 구간 조회 및 `total` 반환.
  - `GET /api/images/ids`: 액자 롤링용 경량 목록 조회.
  - `GET /api/filters`: 앨범별·태그별 카운트 집계 반환.

### Baseline Tests
- R2 업로드/조회/삭제 및 D1 실패 시 R2 롤백 단위/통합 테스트(로컬 Miniflare 또는 메모리 어댑터).
- WebP 매직 바이트 위조 파일 및 용량 초과 파일 `400/413` 거부 테스트.
- EXIF 촬영일 우선 정렬(`taken_at DESC, id DESC`) 및 앨범/태그 복합 필터링, `offset/limit` 구간 페이징 정합성 테스트.
- `GET /api/media/*` 미인증 `401`, 인증 시 `Cache-Control: private, max-age=31536000, immutable` 헤더 검증 테스트.

### Exit Criteria
- 모든 갤러리 조회 API, Private R2 미디어 스트리밍 API, 관리자 CRUD API가 계약(`DESIGN.md` §5)대로 동작하고 테스트를 통과한다.

Files:
- `docs/IMPLEMENT.md` (modified)
- `src/worker/__tests__/api.test.ts` (added)
- `src/worker/__tests__/testHarness.ts` (added)
- `src/worker/index.ts` (modified)
- `src/worker/routes/admin.ts` (added)
- `src/worker/routes/images.ts` (added)
- `src/worker/routes/media.ts` (added)
- `src/worker/validation.ts` (added)
- `tsconfig.worker.json` (modified)

---

## Phase 4 — 관리자 페이지 (`/admin`): EXIF 추출, WebP 변환 & 다중 업로드/관리 UI: done

Refs: RQ-2, RQ-5, RQ-6, RQ-7, RQ-11, DC-2, DC-3, DC-5, DC-9, M-4, M-5, M-9

### Entry Criteria
- Phase 3 완료.

### Implementation Checklist
- [x] `src/client/lib/exif.ts`: JPEG EXIF `DateTimeOriginal`/`CreateDate` 및 `Orientation` 추출, EXIF 없는 파일 fallback 처리.
- [x] `src/client/lib/imageResize.ts`: 브라우저 Canvas 기반 표시용 WebP(최대 2048px, `q=0.82`) + 썸네일 WebP(최대 480px, `q=0.75`) 변환 및 크기/해상도 반환.
- [x] `src/client/components/admin/UploadDropzone.tsx`: 드래그 앤 드롭 다중 선택, 기본 앨범/태그 지정, 동시성 3 업로드 큐, 파일별 상태·진행률·원본 대비 용량 절감률 표시, 실패 항목 재시도.
- [x] `src/client/components/admin/ImageManageTable.tsx`: 업로드된 이미지 검색/목록, 인라인 캡션·앨범·태그·촬영일 수정, 단건/다중 선택 삭제(명시적 확인 모달 포함).
- [x] `src/client/components/admin/AlbumManager.tsx` & `UserAllowlistManager.tsx`: 앨범 CRUD, 허용 사용자(`admin`/`viewer`) 및 가입 승인 대기열 관리, 저장 용량 현황(`사용 GB / 10 GB` 게이지) 표시.

### Baseline Tests
- `exif.ts`: EXIF 포함 JPEG 샘플(촬영일·회전값), EXIF 없는 PNG/WebP, 손상 헤더 fallback 단위 테스트.
- `imageResize.ts`: 가로/세로 긴 이미지 리사이징 비율 유지, 작은 이미지 미확대 검증 단위 테스트.
- `UploadDropzone`, `ImageManageTable`, `UserAllowlistManager`, `AlbumManager`/`AdminView` 컴포넌트 테스트 (`lithent/test` + `await act(...)`).

### Exit Criteria
- 관리자 페이지에서 여러 장을 드래그 앤 드롭하면 브라우저에서 WebP 2종으로 변환되어 업로드되고, 저장 용량 통계 및 이미지/앨범/태그/사용자 관리가 정상 동작한다.

Files:
- `docs/IMPLEMENT.md` (modified)
- `src/client/App.tsx` (modified)
- `src/client/__tests__/AlbumManager.test.tsx` (added)
- `src/client/__tests__/App.test.tsx` (modified)
- `src/client/__tests__/ImageManageTable.test.tsx` (added)
- `src/client/__tests__/UploadDropzone.test.tsx` (added)
- `src/client/__tests__/UserAllowlistManager.test.tsx` (added)
- `src/client/__tests__/exif.test.ts` (added)
- `src/client/__tests__/imageResize.test.ts` (added)
- `src/client/api/admin.ts` (added)
- `src/client/components/admin/AdminView.tsx` (added)
- `src/client/components/admin/AlbumManager.tsx` (added)
- `src/client/components/admin/ConfirmModal.tsx` (added)
- `src/client/components/admin/ImageManageTable.tsx` (added)
- `src/client/components/admin/StorageGauge.tsx` (added)
- `src/client/components/admin/UploadDropzone.tsx` (added)
- `src/client/components/admin/UserAllowlistManager.tsx` (added)
- `src/client/lib/exif.ts` (added)
- `src/client/lib/format.ts` (added)
- `src/client/lib/imageResize.ts` (added)

---

## Phase 5 — 프론트 갤러리: Virtual Scroll 구간 Fetch, 앨범/태그 필터 & 라이트박스: done

Refs: RQ-2, RQ-6, RQ-7, RQ-8, RQ-9, DC-6, DC-7, DC-9, M-5, M-6, M-7

### Entry Criteria
- Phase 3 완료 (Phase 4와 병렬 가능하나 실데이터 확인을 위해 Phase 4 이후 권장).

### Implementation Checklist
- [x] `src/client/lib/virtualGrid.ts`: 반응형 컬럼 수, 전체 가상 높이, 뷰포트 `[startRow..endRow]` 및 요청 청크(`CHUNK_SIZE = 40`, overscan ±1) 순수 계산 모듈 구현.
- [x] `src/client/stores/galleryStore.ts`: 청크 캐시(`Map<number, ImageItem[]>`), in-flight 중복 요청 방지, 필터 변경 시 generation 토큰 증가 및 캐시 무효화 구현.
- [x] `src/client/components/FilterBar.tsx`: 앨범 드롭다운/칩, 태그 필터, 총 사진 수 표시, `액자 모드` 진입 버튼, (`admin` 전용) `관리자` 링크.
- [x] `src/client/components/VirtualGrid.tsx`: 스크롤 `rAF` 스로틀링, 로딩 중 스켈레톤 슬롯, EXIF 촬영일 배지/반응형 썸네일 카드 렌더링.
- [x] `src/client/components/LightboxModal.tsx`: 고화질 표시용 WebP 뷰어, 촬영일/앨범/태그/캡션 표시, 좌우 키보드(`ArrowLeft`/`ArrowRight`/`Escape`) 및 스와이프 이동, 인접 이미지 1장 프리로드.

### Baseline Tests
- `virtualGrid.ts`: 0건, 1건, 50건, 30,000건 기준 가상 높이·행 범위·청크 인덱스 계산 경계 테스트.
- `galleryStore.ts`: 동일 청크 중복 fetch 방지, 빠른 필터 전환 시 stale 응답 무시 테스트.
- `VirtualGrid`, `FilterBar`, `LightboxModal` 컴포넌트 테스트 (`lithent/test`).

### Exit Criteria
- 수천~수만 건 가상 데이터에서도 DOM 노드 수가 뷰포트 근방으로 일정하게 유지되고, 스크롤 구간에 해당하는 청크만 중복 없이 fetch된다.
- 필터 전환 및 라이트박스 상세 탐색이 부드럽게 동작한다.

Files:
- `docs/IMPLEMENT.md` (modified)
- `src/client/App.tsx` (modified)
- `src/client/__tests__/App.test.tsx` (modified)
- `src/client/__tests__/FilterBar.test.tsx` (added)
- `src/client/__tests__/LightboxModal.test.tsx` (added)
- `src/client/__tests__/VirtualGrid.test.tsx` (added)
- `src/client/__tests__/galleryStore.test.ts` (added)
- `src/client/__tests__/virtualGrid.test.ts` (added)
- `src/client/components/FilterBar.tsx` (added)
- `src/client/components/GalleryView.tsx` (added)
- `src/client/components/LightboxModal.tsx` (added)
- `src/client/components/VirtualGrid.tsx` (added)
- `src/client/lib/format.ts` (modified)
- `src/client/lib/virtualGrid.ts` (added)
- `src/client/stores/galleryStore.ts` (added)

---

## Phase 6 — 전체화면 액자 롤링 모드 (Photo Frame Mode): done

Refs: RQ-2, RQ-10, DC-8, DC-9, M-8

### Entry Criteria
- Phase 5 완료.

### Implementation Checklist
- [x] `src/client/lib/shuffle.ts`: Fisher-Yates 중복 없는 셔플 큐 및 재셔플 시 직전 마지막 항목 중복 방지 로직 구현.
- [x] `src/client/components/PhotoFrameMode.tsx`:
  - 현재 선택된 앨범/태그 필터로 `/api/images/ids` 1회 로드.
  - Fullscreen API 진입/종료 및 Wake Lock 요청/해제(미지원 환경 안전 무시).
  - 2-레이어(`layerA`/`layerB`) 더블 버퍼링 + `new Image()`/`decode()` 프리로드 완료 후 크로스페이드(`1200ms`) + 선택적 Ken Burns 미세 줌 애니메이션.
  - 순차(최신순/오래된순) · 랜덤 셔플 토글, 전환 간격(`3s`/`5s`/`10s`/`30s`), 일시정지/재개, 이전/다음 수동 넘김, 캡션·촬영일 오버레이 토글.
  - 3초 무조작 시 컨트롤 HUD 자동 숨김 및 이미지 로드 실패 시 자동 스킵(최대 3회 연속 실패 시 안내).

### Baseline Tests
- `shuffle.ts`: 1장, 2장, 100장 셔플 시 중복 없음·누락 없음·경계 반복 방지 단위 테스트.
- `PhotoFrameMode`: 타이머 전환(fake timers), 프리로드 실패 시 스킵, 일시정지/재개, 언마운트 시 타이머·리스너·WakeLock 정리 검증 테스트 (`lithent/test`).

### Exit Criteria
- 갤러리의 `액자 모드` 버튼으로 진입해 깜빡임 없는 크로스페이드 롤링, 순차/랜덤 전환, 주기 변경, 필터 범위 재생이 정상 동작한다.

Files:
- `docs/IMPLEMENT.md` (modified)
- `src/client/__tests__/PhotoFrameMode.test.tsx` (added)
- `src/client/__tests__/shuffle.test.ts` (added)
- `src/client/api/admin.ts` (modified)
- `src/client/components/GalleryView.tsx` (modified)
- `src/client/components/PhotoFrameMode.tsx` (added)
- `src/client/index.css` (modified)
- `src/client/lib/shuffle.ts` (added)

---

## Phase 7 — Test Hardening (보안 · 경계 조건 · 성능 · 장애 복구 보강): done

Refs: RQ-3, RQ-4, RQ-5, RQ-8, RQ-10, RQ-11, DC-4, DC-7, DC-8, M-2, M-3, M-6, M-8

### Entry Criteria
- Phase 1 ~ Phase 6 기능 구현 및 기본 테스트 모두 완료.

### Implementation Checklist
- [x] **보안 회귀 테스트 보강:** 변조/만료 쿠키, `viewer`의 모든 `/api/admin/*` 엔드포인트 접근, 존재하지 않는/삭제된 R2 키 요청, Path traversal 형태의 `:id` 입력 차단 테스트 추가.
- [x] **업로드/데이터 정합성 장애 테스트:** R2 성공 후 D1 실패 롤백, 0바이트/비-WebP 위조 파일, 500자 초과 캡션, 50건 초과 일괄 삭제, `BOOTSTRAP_ADMIN_EMAIL` 자기 삭제 차단 테스트 추가.
- [x] **Virtual Scroll & PhotoFrame 스트레스 테스트:** 30,000건 모의 데이터 급스크롤(DOM 상한 및 stale fetch 차단), 0장/1장 앨범에서 액자 모드 진입, 네트워크 오류 연속 발생 시 복구 테스트 추가.
- [x] **코드 품질 게이트:** `pnpm type-check`, `pnpm lint`, `pnpm format:check`, 전체 Vitest 스위트 100% 통과 확인.

### Baseline Tests
- 전체 단위/컴포넌트/Worker 테스트 스위트 일괄 실행 및 0 실패 확인.

### Exit Criteria
- 보안·경계·오류 복구 케이스가 자동화 테스트로 고정되고 모든 정적 검사 및 테스트가 통과한다.

Files:
- `docs/IMPLEMENT.md` (modified)
- `src/client/__tests__/hardening.test.tsx` (added)
- `src/worker/__tests__/hardening.test.ts` (added)

---

## Phase 8 — Integration Test & Cloudflare 배포 검증: in_progress

Refs: RQ-1, RQ-3, RQ-4, RQ-5, RQ-8, RQ-10, RQ-11, DC-1, DC-10, M-1, M-2, M-3, M-4, M-5, M-6, M-7, M-8, M-9, M-10

### Entry Criteria
- Phase 7 완료.
- Cloudflare 계정(R2 버킷, D1 DB) 및 Google Cloud Console OAuth 2.0 클라이언트 자격 증명 준비.

### Implementation Checklist
- [x] 로컬 통합 테스트(실제 빌드된 `dist/client` + `wrangler dev` Miniflare D1/R2 환경에서 `scripts/e2e-local.mjs` / `pnpm test:e2e:local`로 SPA 라우팅, OAuth PKCE 리다이렉트, 인증, 업로드, 가상 스크롤 구간 조회, 필터, Private R2 `ETag`/304, 액자 ID, RBAC, 삭제·권한 철회 전체 흐름 검증).
- [x] Cloudflare 리소스 생성 및 배포 가이드(`README.md`) 정리: D1 원격 마이그레이션, R2 버킷 생성, Secrets(`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`) 등록, Google OAuth Authorized Redirect URI 설정.
- [ ] Cloudflare Workers 프로덕션(또는 스테이징) 배포 후 `MANUAL_TEST_CHECKLIST.md` (`M-1` ~ `M-11`) 전 항목 수동 검증 및 결과 기록.

### Baseline Tests
- 로컬 빌드 + Wrangler E2E 통합 테스트 스위트 통과 (`pnpm test:e2e:local`).
- 프로덕션/스테이징 배포 후 `M-1` ~ `M-11` 수동 체크리스트 전 항목 Pass (운영 자격 증명 등록 후 수행).

### Exit Criteria
- 실제 Cloudflare 도메인에서 Google OAuth 로그인, Private R2 서빙, WebP 업로드, 가상 스크롤, 전체화면 액자 롤링이 모두 통과하고 릴리스 준비가 완료된다.

Files:
- `README.md` (added)
- `docs/IMPLEMENT.md` (modified)
- `package.json` (modified)
- `scripts/e2e-local.mjs` (added)

---

## Phase 9 — 운영 UX 고도화: 대량 정리, 9.5 GB 하드캡, 연도별 Virtual Scroll/액자 & 백그라운드 업로드: done

Refs: RQ-8, RQ-10, RQ-11, RQ-13, RQ-14, RQ-15, DC-12, DC-13, DC-14, DC-15, M-12, M-13

### Entry Criteria
- Phase 1 ~ Phase 7 구현 및 Phase 8 로컬 E2E·배포 가이드 완료.
- 실사용 테스트 중 도출된 대량 관리·과금 방지·연도별 탐색·모바일 업로드 요구사항 확정 (`DC-12` ~ `DC-15`).

### Implementation Checklist
- [x] **일괄 앨범 이동 · 촬영일 설정 · 태그 추가/제거 (`POST /api/admin/images/bulk-update`):** 최대 500건 지원, `ImageManageTable` 일괄 작업 바(앨범 이동, `datetime-local` 일괄 촬영일 적용, 태그 추가/제거, 선택된 사진의 태그 원클릭 제거 칩) 구현.
- [x] **관리자 페이징 선택 & 촬영일 없음 필터:** `40/100/200/500장씩 보기` 선택기(`MAX_PAGE_LIMIT = 500`, `BULK_DELETE_MAX = 500`), `?hasExifDate=false|true` 촬영일 유무 필터, Cloudflare D1 100바인드·R2 1,000키 제한 대응 청크 분할(D1 `IN` 50건, 멀티로우 태그 40쌍, R2 삭제 500키).
- [x] **R2 무료 티어 9.5 GB 하드캡 & 설정 분리:** `R2_STORAGE_HARD_CAP_BYTES = 9,500,000,000` (`MAX_STORAGE_BYTES` 오버라이드, 초과 시 `507 STORAGE_LIMIT_EXCEEDED`), `StorageGauge` 안내 문구, `wrangler.example.jsonc` 템플릿 분리 및 `wrangler.jsonc` `.gitignore` 처리(`scripts/e2e-local.mjs` 자동 fallback 포함).
- [x] **연도별 Virtual Scroll · 모바일 1줄 Sticky 연도 바 · 연도별 액자 모드:** 타임존(`tzOffset`) 반영 연도 집계(`GET /api/images`, `GET /api/filters`), `?year=YYYY&tzOffset=` 인덱스 범위 필터(`GET /api/images`, `GET /api/images/ids`), `virtualGrid.ts` 연도 섹션 계산, 모바일 1줄 슬림 Sticky 연도 바(연도 바로가기 칩 + 현재 연도 액자 버튼), 필터바 연도 선택 및 각 연도 섹션 헤더 `YYYY년 액자` 버튼 구현.
- [x] **전역 백그라운드 업로드 스토어 (`src/client/stores/uploadStore.ts`):** 탭/갤러리 이동 중 업로드 지속, `App` 상단 헤더 `업로드 N/M` 배지, 업로드 중 자동 Screen Wake Lock 및 `beforeunload` 이탈 경고·`overscroll-y-contain` 적용.

### Baseline Tests
- Worker: 일괄 앨범 이동·태그 추가/제거·촬영일 설정, 120건(> D1 100변수) 청크 분할 조회/수정/삭제, `507 STORAGE_LIMIT_EXCEEDED` 하드캡 및 삭제 후 복구, UTC/KST 경계 연도 집계 및 `?year=` 필터, `viewer`의 `bulk-update` 403 차단 테스트.
- Client: `ImageManageTable` 일괄 작업·페이지 크기 변경·촬영일 없음 필터, `virtualGrid.ts` 30,000건 연도 섹션 계산, `VirtualGrid` 1줄 Sticky 연도 바·바로가기·연도 액자, `FilterBar` 연도 선택, `PhotoFrameMode` 연도 필터, `uploadStore` 언마운트 지속·Wake Lock·`beforeunload` 테스트.
- 전체 정적 검사(`format:check`, `type-check`, `lint`), `vitest run`(22파일 78테스트), `vite build`, `pnpm test:e2e:local` 통과.

### Exit Criteria
- 대량 관리(최대 500건), 촬영일 누락 보정, 9.5 GB 과금 방지, 연도별 가상 스크롤/액자, 백그라운드 업로드가 모두 자동화 테스트로 검증되고 프로덕션 배포 가능한 상태가 된다.

Files:
- `.gitignore` (modified)
- `README.md` (modified)
- `docs/DESIGN.md` (modified)
- `docs/IMPLEMENT.md` (modified)
- `docs/MANUAL_TEST_CHECKLIST.md` (modified)
- `docs/REQUIREMENTS.md` (modified)
- `scripts/e2e-local.mjs` (modified)
- `src/client/App.tsx` (modified)
- `src/client/__tests__/AlbumManager.test.tsx` (modified)
- `src/client/__tests__/App.test.tsx` (modified)
- `src/client/__tests__/FilterBar.test.tsx` (modified)
- `src/client/__tests__/ImageManageTable.test.tsx` (modified)
- `src/client/__tests__/PhotoFrameMode.test.tsx` (modified)
- `src/client/__tests__/VirtualGrid.test.tsx` (modified)
- `src/client/__tests__/uploadStore.test.tsx` (added)
- `src/client/__tests__/virtualGrid.test.ts` (modified)
- `src/client/api/admin.ts` (modified)
- `src/client/components/FilterBar.tsx` (modified)
- `src/client/components/GalleryView.tsx` (modified)
- `src/client/components/PhotoFrameMode.tsx` (modified)
- `src/client/components/VirtualGrid.tsx` (modified)
- `src/client/components/admin/AdminView.tsx` (modified)
- `src/client/components/admin/ImageManageTable.tsx` (modified)
- `src/client/components/admin/StorageGauge.tsx` (modified)
- `src/client/components/admin/UploadDropzone.tsx` (modified)
- `src/client/index.css` (modified)
- `src/client/lib/virtualGrid.ts` (modified)
- `src/client/stores/galleryStore.ts` (modified)
- `src/client/stores/uploadStore.ts` (added)
- `src/shared/constants.ts` (modified)
- `src/shared/types.ts` (modified)
- `src/worker/__tests__/api.test.ts` (modified)
- `src/worker/__tests__/hardening.test.ts` (modified)
- `src/worker/env.ts` (modified)
- `src/worker/routes/admin.ts` (modified)
- `src/worker/routes/images.ts` (modified)
- `wrangler.jsonc` -> `wrangler.example.jsonc` (renamed)

---

## Handoff

- **Completed:**
  - `docs/REQUIREMENTS.md`, `docs/DESIGN.md`, `docs/IMPLEMENT.md`, `docs/MANUAL_TEST_CHECKLIST.md` 4종 문서 및 `DC-1`~`DC-15` 전원 확정·동기화 완료.
  - `Phase 1` (`3c004c8`) ~ `Phase 7` (`119c551`) 및 `Phase 8` 로컬 E2E/배포 가이드 (`4eaa5cd`) 완료.
  - `Phase 9 — 운영 UX 고도화` 완료 및 푸시 (`a0c85e1`, `9b05cc4`, `e6462e9`, `cfc02a8`, `730e595`, `bdef8db`, `0baf97d`, `dbc538d`): 일괄 앨범 이동·촬영일 설정·태그 추가/제거, 40/100/200/500장 페이징 + D1/R2 청크 분할, 촬영일 없음 필터, R2 9.5 GB 하드캡, `wrangler.example.jsonc` 분리, 연도별 Virtual Scroll + 모바일 1줄 Sticky 연도 바 + 연도별 액자 모드, 전역 백그라운드 업로드 스토어 + Wake Lock + 헤더 배지 (22파일 78테스트 + 로컬 Wrangler E2E 전체 통과).
- **Next Step:**
  - `pnpm deploy`로 최신 변경 사항 운영 반영 후 실도메인에서 `MANUAL_TEST_CHECKLIST.md` (`M-1`~`M-13`) 최종 수동 검증 및 `Phase 8` `done` 마감.
- **Blockers:**
  - 없음 (Cloudflare D1/R2/Secrets/OAuth 프로비저닝 완료; 사내망에서는 `*.workers.dev` DNS 차단되므로 모바일 LTE/5G 또는 커스텀 도메인으로 확인).
- **Latest Commit SHA:** `dbc538d`
