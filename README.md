# Orange Road Simulation Game

Orange Road(키테레츠 대백과) 만화를 기반으로 한 2D 웹 기반 생활/연애 시뮬레이션 게임.

## 개요

플레이어는 주인공 쿄우스케가 되어 마도카, 히카루 등과의 관계를 쌓아가며 GOTY 수준의 재미를 제공합니다. AI NPC가 자신만의 context와 기억을 가지고 살아움직입니다.

## 기술 스택

- **Frontend**: React + Vite + PixiJS + Tailwind CSS + Zustand
- **Backend**: Hono + Bun
- **AI**: LM Studio (OpenAI Compatible API)
- **Deploy**: Raspberry Pi 4

## 프로젝트 구조

```
orangeroad/
├── frontend/   # PixiJS 게임 + React UI
├── backend/    # Hono API 서버
├── data/       # 캐릭터/장소/이벤트 데이터
├── saves/      # 세이브 데이터
└── README.md
```

## 개발 단계

- [x] 요구사항 분석
- [x] 아키텍처 설계
- [ ] Phase 1: 기본 골격
- [ ] Phase 2: NPC 기본
- [ ] Phase 3: 시스템
- [ ] Phase 4: 콘텐츠
- [ ] Phase 5: 폴리시

## 라이선스

MIT
