# Orange Road Simulation Game

키미가 시작 (Kimagure Orange Road) 만화를 모티브로 한 2D 웹 기반 생활/연애 시뮬레이션 게임입니다. 플레이어는 카스가 쿄우스케가 되어 마도카, 히카루 등과의 관계를 쌓아갑니다. 각 NPC는 LM Studio 위에서 자체 컨텍스트와 기억을 가지고 살아 움직입니다.

A small 2D life-sim built around an LM-Studio-driven NPC AI. Friends-only / not-for-distribution project — no copyrighted assets are bundled.

## 기술 스택 / Stack

- **Frontend**: React 18 + Vite 5 + TypeScript (strict) + PixiJS v8 + Tailwind CSS + Zustand
- **Backend**: Hono 4 + Bun 1.3 + TypeScript (strict) + zod
- **AI**: LM Studio (OpenAI Compatible API, optional — game runs offline with a friendly banner if it's down)
- **Deploy target**: Raspberry Pi 4

## 빠른 시작 / Quick start

```bash
# 1. 백엔드 (port 3001)
cd backend
bun install
bun run src/server.ts

# 2. 프론트엔드 (port 5173)
cd frontend
npm install
npm run dev
```

브라우저에서 <http://localhost:5173> 접속.

## LM Studio (선택)

NPC 대화를 실제로 동작시키려면 LM Studio를 띄워두세요:

1. LM Studio에서 적당한 한국어 채팅 모델을 로드 (Qwen 7B / Gemma 9B 등)
2. **Local Server** 탭에서 `http://localhost:1234`로 서비스 시작
3. 백엔드는 기본값으로 `http://localhost:1234/v1/chat/completions`를 호출합니다

LM Studio가 꺼져 있어도 게임은 동작하며, 대화창에 "LM Studio가 오프라인입니다" 배너가 표시됩니다.

## 프로젝트 구조 / Layout

```
orangeroad/
├── frontend/          # React + Vite + PixiJS 클라이언트
│   ├── src/
│   │   ├── audio/     # AudioEngine (Web Audio 기반 절차적 BGM/SFX)
│   │   ├── core/      # Game (Application, scene 라이프사이클)
│   │   ├── data/      # 타운 좌표, NPC roster
│   │   ├── entities/  # Player, NPC, EntityManager
│   │   ├── scenes/    # GameScene
│   │   ├── store/     # Zustand gameStore
│   │   ├── systems/   # Time, Movement, Dialog, Story, Schedule, Save, Effect
│   │   └── ui/        # React 오버레이 (DialogBox, StoryOverlay, SaveSlotsPanel, etc.)
├── backend/           # Hono + Bun API 서버
│   └── src/
│       ├── ai/        # LLMClient, ContextManager, RelationshipManager, AffinityHeuristic
│       ├── data/      # characters/, schedules/, events/ (JSON)
│       ├── routes/    # /npc, /save, /event, /schedule
│       ├── services/  # NPCService, SaveService, EventService, ScheduleService
│       └── server.ts
├── saves/             # 런타임 세이브/관계 데이터 (gitignore)
├── requirements.md    # FR/NFR 요구사항
├── DESIGN.md          # 아키텍처 설계
└── CLAUDE.md          # 개발 프로세스 가이드
```

## 개발 단계 / Phases

- [x] Phase 1: 기본 골격 (FE/BE setup, town map, 클릭 이동)
- [x] Phase 2: NPC 기본 (배치, AI 통합, 대화)
- [x] Phase 3: 시스템 (시간, 세이브, 감정/관계)
- [x] Phase 4: 콘텐츠 (스토리 이벤트, 일과, 캐릭터별 성격)
- [x] Phase 5: 폴리시 (UI/UX, 사운드/이펙트, 밸런스)

## 라이선스 / License

이 프로젝트는 친구들과의 비공개 학습용 프로젝트입니다. Kimagure Orange Road의 캐릭터·세계관은 Matsumoto Izumi 및 권리자에게 있으며, 본 저장소는 이를 상업적으로 이용하지 않습니다. 코드 자체는 MIT 정신으로 공개하지만 만화 IP는 포함하지 않으며, 게임 내 BGM/SFX는 모두 코드로 합성된 절차적 사운드입니다 (외부 오디오 에셋 미포함).

This is a private learning project. The Orange Road manga, its characters, and world belong to Matsumoto Izumi and rights holders; this repo uses them for non-commercial fan-fiction-style simulation only. Source code is shared in the spirit of MIT, but no manga IP, audio, or art assets are bundled — all in-game BGM/SFX is procedurally synthesised at runtime.
