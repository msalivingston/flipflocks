export type PostmarkRequest = {
  From: string;
  To: string;
  ReplyTo?: string;
  Subject: string;
  HtmlBody: string;
  TextBody: string;
  MessageStream: string;
  Tag: string;
  Metadata: Record<string, string>;
};

export type PostmarkDeliveryResult = {
  messageId: string;
};

export class PostmarkDeliveryError extends Error {
  readonly outcome: "rejected" | "delivery_unknown";

  constructor(
    outcome: "rejected" | "delivery_unknown",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "PostmarkDeliveryError";
    this.outcome = outcome;
  }
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function readPostmarkResponse(
  response: Response,
): Promise<{ message: string | null; messageId: string | null }> {
  try {
    const body = await response.json() as Record<string, unknown>;
    return {
      message: textOrNull(body.Message) ?? textOrNull(body.message),
      messageId: textOrNull(body.MessageID) ?? textOrNull(body.messageId),
    };
  } catch {
    return { message: null, messageId: null };
  }
}

export async function deliverPostmarkMessage({
  endpoint,
  fetchImplementation,
  request,
  token,
}: {
  endpoint: string;
  fetchImplementation: typeof fetch;
  request: PostmarkRequest;
  token: string;
}): Promise<PostmarkDeliveryResult> {
  let response: Response;

  try {
    response = await fetchImplementation(endpoint, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": token,
      },
      body: JSON.stringify(request),
    });
  } catch (error) {
    throw new PostmarkDeliveryError(
      "delivery_unknown",
      "Postmark request outcome is unknown.",
      { cause: error },
    );
  }

  const responseBody = await readPostmarkResponse(response);

  if (!response.ok) {
    throw new PostmarkDeliveryError(
      "rejected",
      responseBody.message ||
        `Postmark rejected the request with status ${response.status}.`,
    );
  }

  if (!responseBody.messageId) {
    throw new PostmarkDeliveryError(
      "delivery_unknown",
      "Postmark accepted the request without a provider message identifier.",
    );
  }

  return { messageId: responseBody.messageId };
}
