/**
 * Re-export the token loader from the existing E2E test infrastructure.
 * AI-driven tests use the same PIXIV_REFRESH_TOKEN mechanism.
 */
export { getRefreshToken } from "../e2e/token-loader";
