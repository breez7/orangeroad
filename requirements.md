# Requirements Document: Orange Road Simulation Game

## 1. Overview

### Vision
Orange Road(키테레츠 대백과) 만화를 기반으로 한 2D 웹 기반 생활/연애 시뮬레이션 게임. 플레이어는 주인공 쿄우스케가 되어 마도카, 히카루 등과의 관계를 쌓아가며 GOTY 수준의 재미를 제공한다.

### Target Users
- 주요 타겟: 친구들 (친밀한 관계의 소수 유저)
- 플랫폼: Web Browser
- 플레이 스타일: 연애 시뮬레이션, 라이프 시뮬레이션 선호자

### Problem Statement
기존 연애 시뮬레이션 게임은 정해진 스크립트를 따르기만 하면 되어 재미가 떨어진다. 본 게임은 AI NPC가 자신만의 context와 기억을 가지고 살아움직여서, 플레이어의 선택이 실제로 게임 세계에 영향을 미치는 경험을 제공한다.

### Scope Boundary
| 포함 (In Scope) | 제외 (Out of Scope) |
|----------------|---------------------|
| 마을 전체 시뮬레이션 | 3D 그래픽 |
| NPC AI 대화 시스템 | 멀티플레이어 동시 접속 |
| 감정/관계 시스템 | 모바일 네이티브 앱 |
| 시간 흐름 시스템 | 상거래 시스템 (IAP) |
| 세이브/로드 | 글로벌 랭킹/리더보드 |

---

## 2. Functional Requirements

### FR-001: NPC 시스템
- **Priority:** Must
- **Description:** 각 NPC는 자신만의 context(기억, 감정, 관계)를 가지고 있으며, 게임 진행 중 지속적으로 축적된다.
- **Acceptance Criteria:**
  - 각 NPC는 고유한 ID와 프로필을 가진다
  - NPC는 과거 대화 내용을 기억한다
  - NPC의 상태(감정, 위치)는 실시간으로 관리된다
  - NPC는 다른 NPC와의 관계도 가진다

### FR-002: NPC AI 시스템
- **Priority:** Must
- **Description:** NPC는 OpenAI 호환 API(LM Studio)를 통해 자율적으로 행동하며 대화에 응답한다.
- **Acceptance Criteria:**
  - NPC는 /v1/chat/completions 엔드포인트로 통신한다
  - 각 NPC 요청에는 해당 NPC의 context가 포함된다
  - NPC 응답은 현재 감정 상태를 반영한다
  - NPC는 독립적으로 행동 판정을 한다

### FR-003: 대화 시스템
- **Priority:** Must
- **Description:** 플레이어와 NPC 간의 대화가 가능하며, 감정이 교류된다.
- **Acceptance Criteria:**
  - 플레이어는 NPC에게 말을 걸 수 있다
  - 대화 내용은 양측의 감정에 영향을 미친다
  - 감정 변화는 이후 대화에 반영된다
  - 감정 상태는 지속된다 (세션 간 유지)

### FR-004: 시간 시스템
- **Priority:** Must
- **Description:** 게임 내 시간이 흐르며, 요일/시간에 따른 이벤트가 발생한다.
- **Acceptance Criteria:**
  - 시간은 가속되어 진행된다
  - 평일: 학교 일과에 따른 스케줄
  - 주말: 자유로운 활동
  - 아침/점심/저녁/밤 구분
  - 요일 시스템 (월~일)

### FR-005: 이동 시스템
- **Priority:** Must
- **Description:** 플레이어와 NPC는 마을 내의 여러 장소를 이동할 수 있다.
- **Acceptance Criteria:**
  - 탑뷰 형태의 맵 제공
  - 이동 가능한 장소: 학교, 집(쿄우스케, 마도카, 히카루), 카페, 공원, 거리 등
  - 클릭/터치로 이동
  - NPC들도 자율적으로 이동
  - 같은 장소에 있을 때만 대화 가능

### FR-006: 스토리 진행
- **Priority:** Should
- **Description:** 쿄우스케가 이사 오며 마도카를 만나는 장면부터 시작하며, 원작 스토리를 따르되 플레이어 선택에 의해 분기한다.
- **Acceptance Criteria:**
  - 초반 인트로 장면 제공
  - 주요 스토리 이벤트 존재
  - 플레이어 선택에 따른 분기
  - 에스퍼 능력 관련 이벤트 (스토리용)
  - 히카루 vs 마도카 루트 가능

### FR-007: 관계/감정 시스템
- **Priority:** Must
- **Description:** 플레이어와 각 NPC 간의 관계도가 존재하며, 행동에 따라 변화한다.
- **Acceptance Criteria:**
  - 각 NPC별 호감도/관계 수치
  - 행동에 따른 호감도 변화
  - 관계도에 따른 대화 반응 변화
  - 연애 성립 가능 (특정 인물에 한정되지 않음)

### FR-008: 세이브/로드
- **Priority:** Must
- **Description:** 플레이어는 게임 진행 상황을 저장하고 불러올 수 있다.
- **Acceptance Criteria:**
  - 세이브 슬롯 제공
  - 플레이어 위치, 시간, NPC 상태, 관계도 저장
  - RPi 서버에 저장
  - 언제든지 로드 가능

### FR-009: 일과 시스템
- **Priority:** Should
- **Description:** 학생인 쿄우스케의 일상 스케줄이 구현된다.
- **Acceptance Criteria:**
  - 평일: 아침(등교) → 학교 → 점심 → 방과후 → 저녁(집) → 밤
  - 주말: 자유로운 활동
  - 각 시간대별로 가능한 활동 다름

### FR-010: 캐릭터
- **Priority:** Must
- **Description:** Orange Road의 주요 캐릭터들이 NPC로 등장한다.
- **Characters:**
  - **플레이어:** 카스가 쿄우스케 (주인공, 에스퍼)
  - **주요 히로인:** 아야카와 마도카, 히카루 히야마
  - **가족:** 만타, 쿠루미 (쌍둥이 여동생)
  - **친구:** 유사카, 세이코, 마스미 등
  - **그 외:** 학교 친구들, 마을 사람들

---

## 3. Non-Functional Requirements

### NFR-001: Performance
- 웹 게임 60fps 목표
- NPC AI 응답: 3초 이내 (LM Studio 의존)
- 동시 접속: 1~5명 (친구들)

### NFR-002: Platform
- 웹 브라우저 지원 (Chrome, Firefox, Safari 최신 버전)
- 2D 그래픽
- 탭뷰 시점

### NFR-003: Scalability
- 소수 유저 타겟으로 대규모 확장 불필요
- RPi4 단일 서버로 운영

### NFR-004: Availability
- 24/7 운영 목표 (친구들 접근용)
- 서버 다운 시 복구 계획 필요

### NFR-005: Security
- 기본적인 인증 (친구들 접근 제한)
- API 엔드포인트 보안

### NFR-006: Storage
- 게임 저장 데이터: RPi 로컬 스토리지
- NPC context 영구 저장

---

## 4. Technical Architecture (제안)

### Frontend
- **Framework:** React + Vite
- **Game Engine:** PixiJS (2D 웹 게임)
- **UI:** Tailwind CSS
- **State Management:** Zustand

### Backend
- **Runtime:** Node.js + Bun
- **Framework:** Hono (경량)
- **API:** RESTful API

### AI Integration
- **Local LLM:** LM Studio (OpenAI 호환 API)
- **추천 모델:** Llama 3.1 8B 또는 Mistral 7B (RPi4 가능 시)
- **Context 관리:** 각 NPC별 별도 context window

### Deployment
- **Server:** Raspberry Pi 4 (자체 호스팅)
- **Reverse Proxy:** Nginx
- **Process Manager:** PM2

---

## 5. Constraints

### Technical
- RPi4에서 구동 가능한 아키텍처
- 웹 브라우저 기반 (별도 설치 불필요)
- LM Studio OpenAI 호환 API 사용

### Resource
- 개발자: 1명
- 도구: Claude Code + GitHub
- 인프라: RPi4

### Schedule
- 완료 기준: 만족할 만한 결과가 나올 때까지

---

## 6. Assumptions & Risks

### Assumptions
- LM Studio가 `/v1/chat/completions` 엔드포인트를 제공한다
- RPi4가 게임 서버 + LLM 호스트 모두 구동 가능하다
- 플레이어들은 Orange Road 원작을 알고 있다

### Risks
| 리스크 | 대응 방안 |
|--------|----------|
| RPi4 성능 부족 | 클라우드 LLM API로 폴백 고려 |
| LM Studio API 호환성 문제 | OpenAI SDK 사용으로 완화 |
| NPC context 급증 | context window 관리, 요약 기능 |
| 네트워크 대기 시간 | streaming 응답 구현 |

---

## 7. MVP Development Priority (제안)

### Phase 1: 기본 골격
1. 프로젝트 설정 (Frontend + Backend)
2. 간단한 탭뷰 맵 렌더링
3. 플레이어 캐릭터 이동

### Phase 2: NPC 기본
4. NPC 기본 배치
5. NPC AI 연동 (LM Studio)
6. 기본 대화 시스템

### Phase 3: 시스템
7. 시간 시스템
8. 세이브/로드
9. 감정/관계 시스템 기본

### Phase 4: 콘텐츠
10. 스토리 이벤트
11. 일과 시스템
12. 캐릭터별 개성 부여

### Phase 5: 폴리시
13. UI/UX 개선
14. 사운드/이펙트
15. 밸런스 조정

---

## 8. Out of Scope
- 멀티플레이어 동시 접속에 따른 충돌 처리
- 3D 그래픽
- 인게임 결제
- 모바일 네이티브 앱
- 음성 대화
- 글로벌 서비스
