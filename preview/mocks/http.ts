type MockCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export async function fetch(
  input: string | URL | Request,
  init?: RequestInit & { connectTimeout?: number },
): Promise<Response> {
  const url = String(input);
  const body = parseBody(init?.body);
  const messages = Array.isArray(body.messages)
    ? (body.messages as Record<string, unknown>[])
    : [];
  const lastUser = [...messages]
    .reverse()
    .find((message) => message.role === "user" && typeof message.content === "string");
  const text = typeof lastUser?.content === "string" ? lastUser.content : "";
  const hasToolResult = messages.some((message) => message.role === "tool");
  const ollama = url.includes("/api/chat");

  if (hasToolResult) {
    return reply(
      ollama,
      "Записал телевизор за 1 000 BYN в категорию «Техника». Остаток на карте уменьшился.",
      [],
    );
  }
  if (/телевизор/i.test(text)) {
    return reply(ollama, "", [
      {
        id: "call_1",
        name: "add_expense",
        arguments: {
          amount: "1000.00",
          account: "Карта",
          category: "Техника",
          title: "телевизор",
          description: "устал тащить его домой",
        },
      },
    ]);
  }
  if (/сколько|потрат/i.test(text)) {
    return reply(ollama, "В этом месяце на продукты ушло 109,00 BYN — две покупки.", []);
  }
  if (/работает/i.test(text)) {
    return reply(ollama, "Работает.", []);
  }
  return reply(
    ollama,
    "Могу записать расход, доход или перевод, показать операции месяца и поработать с категориями. Что сделать?",
    [],
  );
}

function reply(ollama: boolean, content: string, calls: MockCall[]): Response {
  if (ollama) {
    return json({
      message: {
        role: "assistant",
        content,
        ...(calls.length > 0
          ? {
              tool_calls: calls.map((call) => ({
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      },
      done: true,
    });
  }
  return json({
    choices: [
      {
        message: {
          role: "assistant",
          content: content || null,
          ...(calls.length > 0
            ? {
                tool_calls: calls.map((call) => ({
                  id: call.id,
                  type: "function",
                  function: {
                    name: call.name,
                    arguments: JSON.stringify(call.arguments),
                  },
                })),
              }
            : {}),
        },
      },
    ],
  });
}

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function parseBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== "string") {
    return {};
  }
  try {
    const parsed = JSON.parse(body) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
