/**
 * Mock LM Studio server for Playwright integration tests (issue #17).
 *
 * Implements just enough of /v1/chat/completions to satisfy backend's
 * LLMClient. Returns deterministic Korean responses based on the user
 * message so tests can assert on the rendered text.
 */

const PORT = Number(process.env.MOCK_LM_PORT ?? 11999);

interface ChatCompletionRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  stream?: boolean;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function chooseResponse(userText: string): string {
  // Deterministic response shaped to trigger the affinity heuristic
  // when tests want to verify positive/negative paths.
  if (/(사랑|좋아|예뻐|멋)/.test(userText)) {
    return '응... 고마워. 너랑 같이 있으면 마음이 편해져.';
  }
  if (/(싫어|미워|짜증|바보)/.test(userText)) {
    return '...뭐? 농담이지?';
  }
  // Trigger a simulated 503 for the offline test path.
  if (userText === '__LM_OFFLINE__') {
    return '__SIMULATE_503__';
  }
  return '응, 잘 지내고 있어. 너는?';
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === '/v1/health' && req.method === 'GET') {
      return Response.json({ status: 'ok', kind: 'mock-lmstudio' }, { headers: corsHeaders });
    }

    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      let body: ChatCompletionRequest;
      try {
        body = (await req.json()) as ChatCompletionRequest;
      } catch {
        return Response.json({ error: 'invalid_json' }, { status: 400, headers: corsHeaders });
      }
      const lastUser = [...body.messages].reverse().find((m) => m.role === 'user');
      const userText = (lastUser?.content ?? '').replace(/<\/?player>/gi, '');
      const replyText = chooseResponse(userText);
      // Simulate LM Studio being offline for the 503 test path.
      if (replyText === '__SIMULATE_503__') {
        return Response.json(
          { error: { message: 'model is currently loading', type: 'server_error' } },
          { status: 503, headers: corsHeaders },
        );
      }
      return Response.json(
        {
          id: `mock-${Date.now()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: body.model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: replyText },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        },
        { headers: corsHeaders },
      );
    }

    return new Response(`mock-lmstudio: 404 ${url.pathname}`, {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
    });
  },
});

console.log(`[mock-lmstudio] listening on http://localhost:${server.port}`);
