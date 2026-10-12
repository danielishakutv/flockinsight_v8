/**
 * The church wallet is held in naira. Always — for a church in Maputo or
 * Nairobi as much as one in Lagos.
 *
 * It is topped up through Paystack in naira, debited for SMS and storage in
 * naira, and credited with referral rewards in naira. But four screens
 * formatted it with the church's own currency, so a Kenyan church's ₦5,000
 * read as "KSh 5,000" (about twelve times the money), a ₦2,000 storage bundle
 * as "MT 2,000", and the dashboard card — which said "₦5,000" — disagreed with
 * the wallet page one click away. Every wallet, storage, SMS-credit and
 * referral figure is formatted with THIS, never with `church.currency`.
 *
 * Client-safe, so components can import it; lib/wallet.ts is server-only.
 */
export const WALLET_CURRENCY = "NGN" as const;
