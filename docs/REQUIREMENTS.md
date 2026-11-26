# r2album 요구사항 명세서 (REQUIREMENTS)

> **문서 위치 및 코드 범위**
> - Canonical 문서 위치: `docs/` (`REQUIREMENTS.md`, `DESIGN.md`, `IMPLEMENT.md`, `MANUAL_TEST_CHECKLIST.md`)
> - 대상 저장소: `r2album` (`https://github.com/superlucky84/r2album`)
> - 적용 코드 범위: 전체 애플리케이션 (`src/client/` Lithent CSR SPA, `src/worker/` Cloudflare Workers API, `migrations/` D1 SQL 마이그레이션, `wrangler.example.jsonc` / 로컬 `wrangler.jsonc`)
> - 상태 표기 원칙: **확정 요구사항(Confirmed)** 과 **미확정/추정 항목(`TBD`)** 을 명확히 구분합니다.

---

## 1. 프로젝트 개요 및 목표

`r2album`은 **Cloudflare R2(월 10GB 무료 티어, 송신 트래픽 무료)** 를 저장소로 활용해 최대한 많은 개인/가족 사진을 보관하고, **Google OAuth 로그인**을 통해 허가된 사용자만 갤러리와 **디지털 액자 롤링 모드**로 감상할 수 있는 프라이빗 클라우드 앨범 웹 애플리케이션입니다.

### 핵심 목표
1. **초저비용·무관리 운영:** Cloudflare Workers 올인원(Static Assets + Worker API + R2 + D1)으로 서버 관리 없이 무료 티어 중심 운영.
2. **저장 효율 극대화:** 브라우저에서 EXIF 촬영일을 보존 추출한 뒤 WebP 표시용 + WebP 썸네일로 변환 업로드하여 10GB 무료 용량에 **약 30,000장 이상** 수납.
3. **쾌적한 대량 감상 경험:** Virtual Scroll + 구간별 Lazy Fetch로 수만 장 환경에서도 가볍게 탐색하고, 전체화면 액자 롤링 모드로 부드럽게 감상.
4. **명확한 권한 제어:** Google OAuth 직접 구현 + `admin` / `viewer` 역할 분리 + Private R2 보호.

---

## 2. 확정 요구사항 (Confirmed Requirements)

| ID | 분류 | 요구사항 | 상태 |
|---|---|---|---|
| `RQ-1` | 인프라/배포 | **Cloudflare Workers 올인원 구조**로 배포한다. CSR SPA 정적 에셋(Static Assets)과 API Worker를 단일 도메인에서 제공하고, 미디어는 Private R2, 메타데이터는 D1(SQLite)에 저장한다. | Confirmed |
| `RQ-2` | 프론트엔드 | 프론트엔드는 **`lithent` (Vite + TypeScript + Tailwind CSS)** 기반 CSR SPA로 구현한다. `lithent` 클로저 컴포넌트 규약(`mount`/`lmount` 모드 일관성, 리스트 `key`, `lithent/test`)을 준수한다. | Confirmed |
| `RQ-3` | 인증/권한 | **Google OAuth 2.0**을 직접 구현한다. 허용된 사용자만 접근 가능하며 역할을 **`admin`**(업로드·편집·삭제·관리자 페이지)과 **`viewer`**(갤러리·라이트박스·액자 모드 열람 전용)로 분리한다. | Confirmed |
| `RQ-4` | 보안 | R2 버킷은 **Private**으로 유지하며 퍼블릭 접근을 허용하지 않는다. 로그인 세션 검증 없이 이미지 바이너리나 메타데이터 API에 접근할 수 없으며, R2/OAuth 비밀키는 클라이언트에 절대 노출하지 않는다. | Confirmed |
| `RQ-5` | 이미지 최적화 | 업로드 시 브라우저에서 이미지의 **EXIF 촬영일 및 회전 방향**을 먼저 추출한 뒤, 원본 대신 **표시용 WebP(최대 2048px)** 와 **썸네일 WebP(최대 480px)** 두 가지 파생본을 생성해 R2에 저장한다. | Confirmed |
| `RQ-6` | 정렬 | 갤러리 기본 정렬은 **EXIF 촬영일 우선 최신순(내림차순)** 으로 한다. EXIF 촬영일이 없거나 파싱 불가한 이미지는 **업로드 시각**을 정렬 기준 시각으로 사용한다. | Confirmed |
| `RQ-7` | 분류/메타데이터 | 각 이미지는 **앨범(단일 또는 미분류)**, **태그(복수)**, **캡션(자유 텍스트)** 메타데이터를 가질 수 있으며, 갤러리에서 앨범 및 태그 기준으로 필터링할 수 있다. | Confirmed |
| `RQ-8` | 갤러리/가상스크롤 | 프론트 메인 화면은 최신순 썸네일 그리드로 표시한다. **Virtual Scroll**을 적용해 전체 개수 기반 스크롤 영역을 계산하고, **현재 뷰포트에 필요한 인덱스 구간의 데이터만 그때그때 API로 fetch**하고 메모리 캐싱한다. | Confirmed |
| `RQ-9` | 상세 보기 | 썸네일을 클릭하면 라이트박스(상세 보기)에서 표시용 고화질 WebP 이미지, 촬영일/업로드일, 앨범, 태그, 캡션을 확인하고 이전/다음 이미지로 이동할 수 있다. | Confirmed |
| `RQ-10` | 액자 롤링 모드 | 기본 갤러리 화면에서 **`액자 모드` 버튼**으로 전체화면 롤링 모드에 진입한다. 다음 이미지를 사전 로드(preload)한 뒤 부드러운 **Fade 전환(및 선택적 Ken Burns 효과)** 으로 표시하며, **순차 / 중복 없는 랜덤 셔플**, **전환 간격(예: 3s/5s/10s/30s)**, **일시정지/재개**, **현재 필터(전체/앨범/태그) 범위 재생**을 지원한다. | Confirmed |
| `RQ-11` | 관리자 페이지 | `admin` 권한 전용 **`/admin` 페이지**를 제공한다. 드래그 앤 드롭 다중 이미지 업로드(클라이언트 리사이징·업로드 진행률 표시), 업로드 시 기본 앨범/태그 지정, 이미지 메타데이터(앨범·태그·캡션·촬영일) 수정, 다중 선택 일괄 앨범 이동·일괄 태그 추가/제거, 이미지 삭제(R2 객체 + D1 레코드 동시 삭제), 9.5 GB 무료 티어 보호 하드캡을 지원한다. | Confirmed |
| `RQ-12` | 가입 신청/승인 | 미등록 Google 계정이 로그인을 시도하면 자동으로 **가입 신청(`pending`)** 으로 접수하고 세션은 발급하지 않은 채 승인 대기 안내 화면을 표시한다. 관리자는 `/admin`에서 대기 목록(이름·이메일·신청일시)을 보고 **승인(`viewer`/`admin`)** 또는 **거절(`rejected`)** 처리할 수 있다. | Confirmed |

---

## 3. 제약 조건 및 가정 (Constraints & Assumptions)

### 제약 조건
- **무료 티어 예산:** Cloudflare R2 Standard 월 10GB 저장, 월 100만 Class A / 1,000만 Class B 요청, Workers 무료 플랜(일 10만 요청), D1 무료 플랜 범위 내에서 개인/가족 용도로 안정 동작해야 한다.
- **브라우저 호환성:** 최신 데스크톱/모바일 브라우저(Chrome, Safari, Edge, Firefox)에서 WebP 인코딩(`HTMLCanvasElement.toBlob('image/webp')` 또는 `OffscreenCanvas`)과 Fullscreen API가 동작해야 한다.
- **비밀 정보 관리:** `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` 등 모든 시크릿은 Cloudflare Workers Secrets(`.dev.vars` 로컬 전용, `.gitignore` 등록)로만 관리하며 git에 커밋하지 않는다.
- **프레임워크 기준:** 로컬 참고 저장소(`/Users/n250109005/project/lithent`, `lithent` v1.26.x / `createLithent/basic`)의 Vite 8 + `@lithent/lithent-vite` + Tailwind CSS v4 구성을 기준으로 한다.

### 가정 및 참고 사항
- **HEIC/HEIF 파일 지원 범위:** Safari는 HEIC 디코딩을 네이티브 지원하지만 Chrome/Firefox 데스크톱에서는 브라우저 내 디코딩이 제한될 수 있다. 1차(MVP)는 브라우저 네이티브 디코딩 가능 포맷(JPEG, PNG, WebP, GIF 정지컷, Safari HEIC)을 기본 지원하고 미지원 포맷은 명확한 오류 메시지로 안내한다.

### 추가 확정 결정 반영
- **허용 사용자 관리 (`DC-3` 확정):** `BOOTSTRAP_ADMIN_EMAIL` 환경변수(최초 관리자) + D1 `allowed_users` 테이블 + `/admin` UI로 재배포 없이 `admin`/`viewer` 이메일을 관리한다.
- **업로드 전송 경로 (`DC-5` 확정):** 브라우저 WebP 변환본(~300KB/장)을 Worker R2 네이티브 바인딩(`POST /api/admin/images`)으로 동시성 3 큐 업로드한다.
- **로컬 개발 서버 구성 (`DC-10` 확정):** `vite`(프론트 HMR + `/api`, `/auth` 프록시)와 `wrangler dev`(로컬 Worker + D1/R2 에뮬레이션)를 병행 실행하고, 배포 시 단일 Worker로 통합한다.

---

## 4. 비목표 (Non-Goals)

1차(MVP) 범위에서 의도적으로 제외하는 항목입니다.
- 원본 RAW/무손실 파일 영구 보관 및 원본 다운로드 기능 (`RQ-5`에 따라 용량 최적화 우선).
- 동영상(MP4/MOV 등) 업로드 및 스트리밍 재생.
- 비로그인 외부 사용자용 퍼블릭 공유 링크 발급.
- SSR(Server-Side Rendering) 및 SEO 최적화 (비공개 인증 앱이므로 불필요).
- AI 자동 태깅, 얼굴 인식, 위치(GPS) 지도 뷰.
- 다중 테넌트(누구나 가입해 독립 갤러리를 만드는 공개 SaaS 형태).

---

## 5. 데이터 및 마이그레이션 고려사항

- **신규 그린필드 프로젝트:** 기존 데이터 마이그레이션은 없으며, D1 스키마는 버전이 매겨진 SQL 마이그레이션 파일(`migrations/0001_init.sql` 등)로 관리한다.
- **R2–D1 정합성:**
  - 업로드 시 R2 저장 성공 후 D1 insert가 실패하면 방금 올린 R2 객체(표시용 + 썸네일)를 즉시 롤백 삭제한다.
  - 이미지 삭제 시 D1 레코드와 R2 객체 2개(표시용 + 썸네일)를 함께 제거하며, 삭제 전 관리자 확인 프롬프트를 필수로 거친다.
- **저장 용량 가시성:** D1에 각 이미지의 `display_bytes`와 `thumb_bytes`를 기록해 `/admin`에서 현재 총 저장 이미지 수와 추정 사용 용량(예: `1.42 GB / 10 GB`)을 실시간으로 확인할 수 있게 한다.
