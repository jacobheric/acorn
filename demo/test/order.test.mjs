import assert from "node:assert/strict";
import { test } from "node:test";
import { quoteOrder } from "../src/order.mjs";

test("adds item quantities in cents", () => {
  assert.deepEqual(
    quoteOrder({
      items: [
        { priceCents: 1250, quantity: 2 },
        { priceCents: 499, quantity: 1 },
      ],
    }),
    {
      subtotalCents: 2999,
      discountCents: 0,
      shippingCents: 0,
      totalCents: 2999,
    },
  );
});
test("discounts merchandise before adding shipping", () => {
  assert.equal(
    quoteOrder({
      items: [{ priceCents: 2000, quantity: 2 }],
      discountPercent: 25,
      shippingCents: 500,
    }).totalCents,
    3500,
  );
});
test("rounds a fractional cent discount", () => {
  assert.equal(
    quoteOrder({
      items: [{ priceCents: 999, quantity: 1 }],
      discountPercent: 10,
    }).discountCents,
    100,
  );
});
test("a full discount still pays shipping", () => {
  assert.equal(
    quoteOrder({
      items: [{ priceCents: 1000, quantity: 1 }],
      discountPercent: 100,
      shippingCents: 350,
    }).totalCents,
    350,
  );
});
test("rejects an empty basket", () =>
  assert.throws(() => quoteOrder({ items: [] }), /at least one/));
test("rejects fractional quantities", () =>
  assert.throws(
    () => quoteOrder({ items: [{ priceCents: 100, quantity: 1.5 }] }),
    /Quantity/,
  ));
test("rejects negative prices", () =>
  assert.throws(
    () => quoteOrder({ items: [{ priceCents: -100, quantity: 1 }] }),
    /Price/,
  ));
test("rejects discounts over 100 percent", () =>
  assert.throws(
    () =>
      quoteOrder({
        items: [{ priceCents: 100, quantity: 1 }],
        discountPercent: 101,
      }),
    /Discount/,
  ));
test("rejects invalid shipping", () =>
  assert.throws(
    () =>
      quoteOrder({
        items: [{ priceCents: 100, quantity: 1 }],
        shippingCents: -1,
      }),
    /Shipping/,
  ));
test("rejects totals beyond safe integer precision", () =>
  assert.throws(
    () =>
      quoteOrder({
        items: [{ priceCents: Number.MAX_SAFE_INTEGER, quantity: 2 }],
      }),
    /too large/,
  ));
