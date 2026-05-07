# Orange Road Simulation Game

키미가 시작 (Kimagure Orange Road) 만화를 모티브로 한 2D 웹 기반 생활/연애 시뮬레이션 게임입니다. 플레이어는 카스가 쿄우스케가 되어 마도카, 히카루 등과의 관계를 쌓아갑니다. 각 NPC는 LM Studio 위에서 자체 컨텍스트와 기억을 가지고 살아 움직입니다.

A small 2D life-sim built around an LM-Studio-driven NPC AI. Friends-only / not-for-distribution project — no copyrighted assets are bundled.

## 기술 스택 / Stack

- **Frontend**: React 18 + Vite 5 + TypeScript (strict) + PixiJS v8 + Tailwind CSS + Zustand
- **Backend**: Hono 4 + Bun 1.3 + TypeScript (strict) + zod
- **AI**: LM Studio (OpenAI Compatible API, optional — game runs offline with a friendly banner if it's down)
- **Deploy target**: Raspberry Pi 4

## 사전 준비 / Prerequisites

| 도구 | 버전 | 설치 방법 |
|---|---|---|
| Bun | ≥ 1.3 | `curl -fsSL https://bun.sh/install \| bash` |
| Node.js | ≥ 20 | nvm 권장 (`nvm install 22`) |
| npm | ≥ 10 | Node 와 함께 설치됨 |
| (선택) LM Studio | 0.3+ | <https://lmstudio.ai> |

확인:

```bash
bun --version  # 1.3.x
node --version # v20+ 또는 v22+
npm --version  # 10+
```

## 빠른 시작 / Quick start

저장소를 클론한 첫 한 번만 디펜던시를 깔고, 그 다음부터는 `./dev.sh` 한 줄이면 됩니다.

```bash
# 한 번만 — 디펜던시 설치
cd backend  && bun install && cd ..
cd frontend && npm install  && cd ..

# 매번 — 백엔드 + 프론트엔드 동시 기동
./dev.sh
```

`dev.sh` 가 처음 실행될 때 디펜던시가 빠져 있으면 자동으로 설치합니다.

```
  ──────────────────────────────────────────────
   Orange Road dev servers running
   • frontend   http://localhost:5173
   • backend    http://localhost:3001
   • LM Studio  http://localhost:1234 (optional)
   Ctrl+C to stop.
  ──────────────────────────────────────────────
```

브라우저에서 <http://localhost:5173> 을 열면 인트로 컷씬이 자동으로 시작됩니다. Ctrl+C 한 번이면 두 서버 모두 깔끔하게 종료됩니다.

### 수동으로 두 터미널에 띄우고 싶다면

```bash
# 터미널 1 — 백엔드 (port 3001)
cd backend
bun run src/server.ts

# 터미널 2 — 프론트엔드 (port 5173)
cd frontend
npm run dev
```

## 플레이 가이드 / How to play

브라우저에서 5173 포트를 열면 다음 흐름으로 진행됩니다:

1. **인트로 컷씬** — 화면 하단 패널을 클릭하거나 Space/Enter 로 다음 장면. 마지막 프레임이 끝나면 인트로가 닫히고 자유롭게 움직일 수 있습니다.
2. **클릭 이동** — 마을 어디든 클릭하면 쿄우스케(파란 점)가 그쪽으로 걸어갑니다.
3. **NPC 대화** — 마도카·히카루 등 NPC 가까이로 걸어간 다음 NPC 스프라이트를 클릭하면 대화창이 열립니다. 메시지를 입력하고 Enter / 전송. LM Studio 가 켜져 있으면 진짜 AI 응답이 오고, 꺼져 있으면 "LM Studio 가 오프라인입니다" 배너가 보입니다.
4. **호감도 / 감정** — 대화창 헤더에 0–100 막대와 감정 라벨(평온/기쁨/설렘 등) 이 표시됩니다. 긍정적인 단어("좋아", "고마워", "사랑" …) 가 들어가면 호감도가 오르고, 부정 단어는 떨어집니다. 일정 임계점을 넘으면 **스토리 이벤트**가 자동으로 발화합니다.
5. **세이브 / 로드** — 좌측 상단 "세이브 / 로드" 버튼 → 슬롯 1~3 에 저장. 페이지 새로고침 후 로드하면 위치 / 호감도 / 플래그 / 오디오 설정이 복원됩니다.
6. **시간 / 일과** — 우측 상단 시계가 게임 시간을 표시합니다 (실시간 2초 = 게임 1분 기본). 시간이 진행되면 NPC 들이 자기 일과(학교/카페/놀이터…) 를 따라 자동으로 이동합니다.
7. **사운드** — 우측 하단 스피커 버튼 → BGM on/off, 음악/효과음 볼륨, 음소거. 모든 BGM/SFX 는 Web Audio 로 코드에서 합성되어 외부 에셋이 없습니다.
8. **도움말** — 우측 하단 "?" 버튼 → 단축키 + UX 가이드. ESC 또는 backdrop 클릭으로 닫힘.

### LM Studio 연결 (선택)

NPC 대화에 진짜 AI 응답을 받으려면:

1. LM Studio 에서 한국어 채팅 모델을 로드 (Qwen 7B / Gemma 9B / EXAONE 등 추천)
2. **Local Server** 탭에서 `http://localhost:1234` 로 서버 시작 (OpenAI 호환 모드)
3. 백엔드는 기본값으로 `http://localhost:1234/v1/chat/completions` 를 호출합니다

LM Studio 가 꺼져 있어도 게임 자체는 계속 동작하며, 대화창에 오프라인 배너가 뜹니다 — 호감도/감정/저장/스토리 이벤트는 정상 작동합니다.

환경변수로 다른 엔드포인트나 모델을 바꿀 수 있습니다:

```bash
LM_STUDIO_URL=http://192.168.0.50:1234/v1 \
LM_STUDIO_MODEL=qwen-2.5-7b-instruct \
LM_STUDIO_TIMEOUT_MS=30000 \
bun run src/server.ts
```

## 테스트 실행 / Running tests

전체 통합 테스트 스위트(API 계약 + 11-step 플레이스루) 는 Playwright 로 돌아갑니다. 백엔드/프론트엔드/LM mock 을 모두 자동으로 띄우니 별도 사전 작업이 필요 없습니다.

```bash
# 한 번만 — Playwright 브라우저 다운로드
cd frontend
npx playwright install chromium

# 매번 — 30 개 테스트 (api 29 + playthrough 1) 실행
npm run test            # = npx playwright test
# 또는 통합 테스트만 따로
npx playwright test playthrough
npx playwright test api
```

소요 시간은 Pi 급 머신 기준 약 2.5~3 분입니다.

리포트 / 트레이스:

```bash
# HTML 리포트 (실패시 트레이스 포함)
npx playwright show-report

# 헤드리스 끄고 실제 브라우저로 보고 싶다면
npx playwright test playthrough --headed
```

`npm run test` 스크립트가 없으면 `npx playwright test` 로 직접 실행하면 됩니다 (frontend/package.json 안에서).

## 트러블슈팅 / Troubleshooting

| 증상 | 해결 |
|---|---|
| `dev.sh: Permission denied` | `chmod +x dev.sh` |
| `EADDRINUSE: address already in use 5173` | 다른 vite 가 떠있는지 `lsof -i:5173` 으로 확인 후 종료 |
| 브라우저에서 캔버스만 회색 | 백엔드가 안 떠 있어서 NPC 데이터를 못 받음. `curl localhost:3001/health` 가 200 인지 확인 |
| `LM Studio 가 오프라인입니다` 배너 | LM Studio 가 꺼져 있거나 다른 포트. 게임은 정상 동작하지만 NPC 응답은 안 옴 |
| Playwright 가 chromium 못 찾음 | `npx playwright install chromium` |
| 세이브가 이상한 상태 | `rm -rf saves/*` 로 초기화 (saves/ 는 gitignore 됨) |

## 프로젝트 구조 / Layout

```
orangeroad/
├── frontend/                 # React + Vite + PixiJS 클라이언트
│   ├── src/
│   │   ├── audio/            # AudioEngine (Web Audio 기반 절차적 BGM/SFX)
│   │   ├── core/             # Game (Application, scene 라이프사이클)
│   │   ├── data/             # 타운 좌표, NPC roster
│   │   ├── entities/         # Player, NPC, EntityManager
│   │   ├── scenes/           # GameScene
│   │   ├── store/            # Zustand gameStore
│   │   ├── systems/          # Time, Movement, Dialog, Story, Schedule, Save, Effect
│   │   └── ui/               # React 오버레이 (DialogBox, StoryOverlay, SaveSlotsPanel, …)
│   └── tests/e2e/            # Playwright 통합 테스트
├── backend/                  # Hono + Bun API 서버
│   └── src/
│       ├── ai/               # LLMClient, ContextManager, RelationshipManager, AffinityHeuristic
│       ├── data/             # characters/, schedules/, events/ (JSON)
│       ├── routes/           # /npc, /save, /event, /schedule
│       ├── services/         # NPCService, SaveService, EventService, ScheduleService
│       └── server.ts
├── saves/                    # 런타임 세이브/관계 데이터 (gitignore)
├── dev.sh                    # 백엔드+프론트엔드 한 줄 실행 스크립트
├── requirements.md           # FR/NFR 요구사항
├── DESIGN.md                 # 아키텍처 설계
└── CLAUDE.md                 # 개발 프로세스 가이드
```

## 개발 단계 / Phases

- [x] Phase 1: 기본 골격 (FE/BE setup, town map, 클릭 이동)
- [x] Phase 2: NPC 기본 (배치, AI 통합, 대화)
- [x] Phase 3: 시스템 (시간, 세이브, 감정/관계)
- [x] Phase 4: 콘텐츠 (스토리 이벤트, 일과, 캐릭터별 성격)
- [x] Phase 5: 폴리시 (UI/UX, 사운드/이펙트, 밸런스)
- [x] Phase QA-1: Playwright 통합 테스트 (issue #17, 30/30 PASS, 평가자 108/120)

## 라이선스 / License

이 프로젝트는 친구들과의 비공개 학습용 프로젝트입니다. Kimagure Orange Road의 캐릭터·세계관은 Matsumoto Izumi 및 권리자에게 있으며, 본 저장소는 이를 상업적으로 이용하지 않습니다. 코드 자체는 MIT 정신으로 공개하지만 만화 IP는 포함하지 않으며, 게임 내 BGM/SFX는 모두 코드로 합성된 절차적 사운드입니다 (외부 오디오 에셋 미포함).

This is a private learning project. The Orange Road manga, its characters, and world belong to Matsumoto Izumi and rights holders; this repo uses them for non-commercial fan-fiction-style simulation only. Source code is shared in the spirit of MIT, but no manga IP, audio, or art assets are bundled — all in-game BGM/SFX is procedurally synthesised at runtime.
