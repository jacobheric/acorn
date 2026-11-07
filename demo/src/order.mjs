export const quoteOrder = ({
  items,
  discountPercent = 0,
  shippingCents = 0,
}) => {
  if (!Array.isArray(items) || items.length === 0)
    throw new Error("Add at least one item");
  if (
    !Number.isInteger(discountPercent) ||
    discountPercent < 0 ||
    discountPercent > 100
  )
    throw new Error("Discount must be a whole percentage between 0 and 100");
  if (!Number.isSafeInteger(shippingCents) || shippingCents < 0)
    throw new Error("Shipping must be a nonnegative amount in cents");
  const subtotalCents = items.reduce((sum, { priceCents, quantity }) => {
    if (!Number.isSafeInteger(priceCents) || priceCents < 0)
      throw new Error("Price must be a nonnegative amount in cents");
    if (!Number.isSafeInteger(quantity) || quantity < 1)
      throw new Error("Quantity must be a positive whole number");
    const next = sum + priceCents * quantity;
    if (!Number.isSafeInteger(next)) throw new Error("Order is too large");
    return next;
  }, 0);
  const discountCents = Math.round((subtotalCents * discountPercent) / 100);
  const totalCents = subtotalCents - discountCents + shippingCents;
  if (!Number.isSafeInteger(totalCents)) throw new Error("Order is too large");
  return { subtotalCents, discountCents, shippingCents, totalCents };
};
