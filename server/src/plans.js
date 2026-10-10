/**
 * Plans are prepaid passes (no auto-renewal): buying one grants `days` of premium access; buying again extends it.
 * `priceINR` is what the viewer pays (Razorpay order amount = priceINR × 100 paise).
 */
// The catalogue of plans. `days` is how much premium time a purchase grants; the free plan has 0.
// To change prices edit here (the invoice/GST maths reads the same list).
export const PLANS = [
  { id: 'free', name: 'Free', priceINR: 0, interval: 'forever', days: 0, features: ['All free episodes & reels', 'Watch on any device', 'My List & Continue Watching'] },
  { id: 'plus-monthly', name: 'ADDABAAZ Premium', priceINR: 99, interval: 'month', days: 30, features: ['Everything in Free', 'Premium originals & early access', 'Ad-free viewing', 'Up to 5 profiles'] },
  { id: 'plus-yearly', name: 'ADDABAAZ Premium (Yearly)', priceINR: 799, interval: 'year', days: 365, features: ['Everything in Premium', '2 months free'] },
];
// Looks up a purchasable plan by id; returns null for unknown ids and for the free plan.
export const paidPlan = (id) => PLANS.find((p) => p.id === id && p.priceINR > 0) || null;
