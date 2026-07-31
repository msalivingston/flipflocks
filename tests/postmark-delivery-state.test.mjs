import assert from "node:assert/strict";
import test from "node:test";

import {
  deliverPostmarkMessage,
  PostmarkDeliveryError,
} from "../supabase/functions/postmark-email-worker/delivery-state.ts";

function postmarkRequest() {
  return {
    From: "FlockFront <orders@example.test>",
    To: "buyer@example.test",
    Subject: "Order confirmation",
    HtmlBody: "<p>Order</p>",
    TextBody: "Order",
    MessageStream: "outbound",
    Tag: "flockfront-order-notification",
    Metadata: {
      notification_id: "60000000-0000-4000-8000-000000000001",
      dispatch_attempt_id: "60000000-0000-4000-8000-000000000002",
      order_id: "60000000-0000-4000-8000-000000000003",
    },
  };
}

async function delivery(fetchImplementation) {
  return deliverPostmarkMessage({
    endpoint: "https://api.postmarkapp.com/email",
    fetchImplementation,
    request: postmarkRequest(),
    token: "test-token",
  });
}

test("successful Postmark acceptance requires and returns MessageID", async () => {
  let submittedBody;
  const result = await delivery(async (_url, init) => {
    submittedBody = JSON.parse(init.body);
    return Response.json({
      ErrorCode: 0,
      Message: "OK",
      MessageID: "provider-message-1",
    });
  });

  assert.equal(result.messageId, "provider-message-1");
  assert.deepEqual(submittedBody.Metadata, postmarkRequest().Metadata);
  assert.equal(submittedBody.Tag, "flockfront-order-notification");
});

test("a known Postmark rejection is retryable provider rejection", async () => {
  await assert.rejects(
    delivery(async () =>
      Response.json(
        { ErrorCode: 300, Message: "Invalid recipient" },
        { status: 422 },
      )),
    (error) => {
      assert.ok(error instanceof PostmarkDeliveryError);
      assert.equal(error.outcome, "rejected");
      return true;
    },
  );
});

test("network ambiguity becomes delivery_unknown", async () => {
  await assert.rejects(
    delivery(async () => {
      throw new TypeError("connection reset");
    }),
    (error) => {
      assert.ok(error instanceof PostmarkDeliveryError);
      assert.equal(error.outcome, "delivery_unknown");
      return true;
    },
  );
});

test("provider acceptance without MessageID becomes delivery_unknown", async () => {
  await assert.rejects(
    delivery(async () =>
      Response.json({
        ErrorCode: 0,
        Message: "OK",
      })),
    (error) => {
      assert.ok(error instanceof PostmarkDeliveryError);
      assert.equal(error.outcome, "delivery_unknown");
      return true;
    },
  );
});
