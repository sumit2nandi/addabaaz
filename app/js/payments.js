/* Razorpay Checkout (web). The API creates the order and later verifies the signature;
 * this file only opens the payment window. Card / UPI / netbanking details never touch our servers. */
// The Razorpay script is loaded only when someone actually starts a payment.
let loading = null;
const load = () => loading ||= new Promise((res, rej) => {
  if (window.Razorpay) return res();
  const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.async = true;
  s.onload = res; s.onerror = () => { loading = null; rej(new Error('Could not load the payment window. Check your connection or ad-blocker and try again.')); };
  document.head.appendChild(s);
});

/** @param order the /payments/checkout response → resolves { razorpay_order_id, razorpay_payment_id, razorpay_signature } */
// Opens the payment window. Resolves with the payment result to verify on the server; rejects with `cancelled: true` if the window was closed.
export async function openCheckout(order) {
  await load();
  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay({
      key: order.keyId, order_id: order.orderId, amount: order.amount, currency: order.currency,
      name: 'ADDABAAZ', description: order.plan?.name || 'ADDABAAZ Premium', prefill: order.prefill || {}, theme: { color: '#b80000' },
      handler: resolve,
      modal: { ondismiss: () => reject(Object.assign(new Error('Payment cancelled.'), { cancelled: true })) },
    });
    rzp.on('payment.failed', () => { /* Checkout shows the error and lets the viewer retry inside the window */ });
    rzp.open();
  });
}
