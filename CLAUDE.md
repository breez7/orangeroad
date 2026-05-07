# Orange Road Game - Claude Code Guidelines

## Project Context

Orange Road 만화 기반 2D 웹 시뮬레이션 게임 개발 프로젝트입니다. AI NPC들이 자신만의 context와 기억을 가지고 살아움직이는 연애/생활 시뮬레이션 게임입니다.

## Important: Always Reference Requirements & Design

모든 개발 작업을 시작하기 전에 반드시 다음 문서들을 참조하세요:

- **요구사항**: `requirements.md` - 프로젝트의 전체 요구사항
- **설계**: `/home/james/.claude/plans/humble-painting-harp.md` - 아키텍처 설계

코드를 작성할 때:
1. 먼저 관련 요구사항(FR-XXX)을 확인하세요
2. 설계 문서의 해당 섹션을 참조하세요
3. 설계와 다른 접근이 필요하다면 먼저 설계를 업데이트하세요

## MANDATORY: Developer & Evaluator Agent Feedback Loop

**중요**: 모든 구현 작업은 다음 프로세스를 따라야 합니다:

```
1. Developer Agent 구현
2. Evaluator Agent 평가
3. 피드백 반영
4. 2-3 반복 또는 평가 만족时可
```

### 프로세스 상세

#### 1. 구현 전 (Pre-Implementation)
- 요구사항 확인
- 설계 문서 확인
- 구현 범위 정의

#### 2. Developer Agent 사용
```bash
Agent: developer
- 구현할 기능/컴포넌트 설명
- 관련 요구사항 참조
- 설계 문서의 해당 섹션 참조
```

#### 3. Evaluator Agent 사용
Developer Agent가 코드를 작성한 후, 반드시 Evaluator Agent로 검토:
```bash
Agent: code-reviewer (evaluator)
- 작성된 코드 검토
- 요구사항 충족 여부 확인
- 설계와 일치 여부 확인
- 개선점 제시
```

#### 4. 피드백 반영 및 반복
- Evaluator의 피드백을 반영하여 코드 수정
- 퀄리티가 만족스러울 때까지 2-3단계 반복

### 사용 예시

```
User: "PixiJS로 GameScene을 구현해줘"

Claude:
1. requirements.md와 설계 문서 확인
2. Developer Agent에 작업 지시
3. Evaluator Agent로 코드 검토
4. 피드백 반영
5. 최종 코드 완성
```

## Technical Stack

- **Frontend**: React + Vite + PixiJS + Tailwind CSS + Zustand
- **Backend**: Hono + Bun
- **AI**: LM Studio (OpenAI Compatible API)
- **Deploy**: Raspberry Pi 4

## File Structure

```
orangeroad/
├── frontend/   # PixiJS 게임 + React UI
├── backend/    # Hono API 서버
├── data/       # 캐릭터/장소/이벤트 데이터
├── saves/      # 세이브 데이터
├── requirements.md    # 요구사항 문서
└── CLAUDE.md          # 이 파일
```

## Development Guidelines

1. **TypeScript First**: 모든 코드는 TypeScript로 작성
2. **Component-First**: 가능한 작은 컴포넌트 단위로 개발
3. **Test-Driven 본능**: 중요한 로직은 테스트 고려
4. **Documentation**: 복잡한 로직에는 주석 필수
5. **Design Consistency**: 설계 문서와의 일관성 유지

## Code Review Checklist

모든 PR/변경은 다음을 확인해야 합니다:
- [ ] 요구사항 충족 (FR-XXX)
- [ ] 설계 문서와 일치
- [ ] TypeScript 에러 없음
- [ ] 동작 확인 (dev server)
- [ ] Evaluator Agent 승인

## AI Integration Notes

- LM Studio는 OpenAI 호환 API 제공
- 엔드포인트: `/v1/chat/completions`
- 각 NPC는 독립적인 context 유지
- 감정 상태가 대화에 반영되어야 함

## Quality Standards

GOTY 수준의 재미를 목표로 합니다:
- 매끄러운 60fps
- 직관적인 UI/UX
- 살아있는 NPC AI
- 몰입감 있는 스토리
